// routes/sync.js
const express = require('express');
const axios = require('axios');
const syncService = require('../services/syncService');
const orderService = require('../services/orderService');
const db = require('../config/database');
const { authenticateToken, requireMerchant } = require('../src/middleware/auth');

const router = express.Router();

// Apply authentication middleware
router.use(authenticateToken);
router.use(requireMerchant);

/**
 * POST /api/sync/full
 * Perform full Clover sync for authenticated merchant
 * Syncs categories, products, and inventory from Clover
 */
router.post('/full', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    
    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'Merchant ID not found in request context'
      });
    }

    console.log(`Full sync requested for merchant ${merchantId}`);

    // Check if Clover sync is enabled
    if (!syncService.isEnabled()) {
      console.log('Clover sync is disabled via ENABLE_CLOVER flag');
      return res.json({
        success: true,
        message: 'Clover sync is currently disabled',
        enabled: false,
        categories: { processed: 0 },
        products: { processed: 0 },
        inventory: { processed: 0 },
        timestamp: new Date().toISOString()
      });
    }

    // Perform the full sync
    const result = await syncService.performFullSync(merchantId);

    // Return appropriate status code based on success
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    console.error('Sync endpoint error:', error);
    
    // Handle specific error types
    let statusCode = 500;
    let errorMessage = 'Internal server error during sync';
    
    if (error.message.includes('No Clover token found')) {
      statusCode = 400;
      errorMessage = 'No Clover access token found for this merchant. Please authenticate with Clover first.';
    } else if (error.message.includes('expired')) {
      statusCode = 401;
      errorMessage = 'Clover access token has expired. Please re-authenticate with Clover.';
    } else if (error.message.includes('Merchant not found')) {
      statusCode = 404;
      errorMessage = 'Merchant account not found';
    } else if (error.message.includes('No Clover merchant ID')) {
      statusCode = 400;
      errorMessage = 'No Clover merchant ID associated with this account';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      enabled: syncService.isEnabled(),
      categories: { processed: 0, errors: [errorMessage] },
      products: { processed: 0 },
      inventory: { processed: 0 },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/sync/status
 * Get sync status and feature flag information
 */
router.get('/status', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    
    const status = {
      success: true,
      enabled: syncService.isEnabled(),
      merchant_id: merchantId,
      timestamp: new Date().toISOString()
    };

    // If Clover is enabled, check for token presence
    if (syncService.isEnabled()) {
      try {
        await syncService.getMerchantCloverToken(merchantId);
        status.token_status = 'valid';
      } catch (error) {
        if (error.message.includes('No Clover token found')) {
          status.token_status = 'missing';
        } else if (error.message.includes('expired')) {
          status.token_status = 'expired';
        } else {
          status.token_status = 'error';
          status.token_error = error.message;
        }
      }
    }

    res.json(status);
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check sync status',
      enabled: syncService.isEnabled(),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/sync/orders
 * Sync Clover orders for authenticated merchant
 * Query params:
 *   - limit (int): page size for fetchPaged (default 100)
 *   - prune (boolean): mark local transactions not in Clover with status='delete' (default false)
 * 
 * Behavior controlled by VERCEL_BASE_URL environment variable:
 * - If VERCEL_BASE_URL is set: proxies request to ${VERCEL_BASE_URL}/api/products/sync
 * - If VERCEL_BASE_URL is not set: performs local Clover order sync
 * 
 * Note: Rate limiting should be added in production (similar to /api/sync/full)
 */
router.post('/orders', async (req, res) => {
  const merchantId = req.merchant.id;
  
  if (!merchantId) {
    return res.status(400).json({
      success: false,
      error: 'Merchant ID not found in request context'
    });
  }

  // Check if we should proxy to Vercel
  const vercelBaseUrl = process.env.VERCEL_BASE_URL;
  
  if (vercelBaseUrl && vercelBaseUrl.trim()) {
    // Proxy mode: forward request to Vercel-hosted products sync endpoint
    try {
      // Build target URL with query string
      const baseUrl = vercelBaseUrl.replace(/\/$/, '');
      const targetUrl = `${baseUrl}/api/products/sync`;
      const queryString = new URLSearchParams(req.query).toString();
      const fullUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;
      
      console.log(`Proxying orders sync to Vercel for merchant ${merchantId}: ${fullUrl}`);
      
      // Prepare headers to forward
      const headers = {};
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }
      if (req.headers['content-type']) {
        headers['Content-Type'] = req.headers['content-type'];
      }
      if (req.headers['accept']) {
        headers['Accept'] = req.headers['accept'];
      }
      
      // Make proxied request
      const response = await axios.post(fullUrl, req.body, {
        headers,
        timeout: 120000, // 120 second timeout
        validateStatus: () => true // Accept any status code so we can forward it
      });
      
      // Forward upstream response
      return res.status(response.status).json(response.data);
      
    } catch (error) {
      console.error('Proxy error for orders sync:', error.message);
      
      // Handle network errors (no response from upstream)
      if (!error.response) {
        return res.status(502).json({
          success: false,
          error: 'Bad Gateway: Unable to reach upstream sync endpoint',
          details: error.message,
          timestamp: new Date().toISOString()
        });
      }
      
      // Forward error response from upstream
      return res.status(error.response.status).json(error.response.data);
    }
  }
  
  // Local mode: perform local Clover order sync (original behavior)
  try {
    // Parse query parameters
    const limit = parseInt(req.query.limit) || 100;
    const prune = req.query.prune === 'true' || req.query.prune === true;

    console.log(`Orders sync requested for merchant ${merchantId} (limit=${limit}, prune=${prune})`);

    // Check if Clover sync is enabled
    if (!syncService.isEnabled()) {
      console.log('Clover sync is disabled via ENABLE_CLOVER flag');
      return res.json({
        success: true,
        message: 'Clover sync is currently disabled',
        enabled: false,
        processed: 0,
        inserted: 0,
        updated: 0,
        marked_for_delete: 0,
        unmatched: 0,
        errors: null,
        timestamp: new Date().toISOString()
      });
    }

    // Get merchant's Clover token and merchant ID
    const tokenInfo = await syncService.getMerchantCloverToken(merchantId);
    
    // Get the clover merchant ID from the merchants table
    const client = await db.connect();
    let cloverMerchantId;
    try {
      const merchantResult = await client.query(
        'SELECT clover_merchant_id FROM merchants WHERE id = $1',
        [merchantId]
      );
      if (merchantResult.rows.length === 0) {
        throw new Error('Merchant not found');
      }
      cloverMerchantId = merchantResult.rows[0].clover_merchant_id;
    } finally {
      client.release();
    }

    if (!cloverMerchantId) {
      throw new Error('No Clover merchant ID associated with this merchant');
    }

    // Perform the orders sync
    const result = await orderService.syncOrders(
      merchantId,
      tokenInfo.access_token,
      cloverMerchantId,
      { limit, prune }
    );

    // Return result
    res.json(result);

  } catch (error) {
    console.error('Orders sync endpoint error:', error);
    
    // Handle specific error types
    let statusCode = 500;
    let errorMessage = 'Internal server error during orders sync';
    
    if (error.message.includes('No Clover token found')) {
      statusCode = 400;
      errorMessage = 'No Clover access token found for this merchant. Please authenticate with Clover first.';
    } else if (error.message.includes('expired')) {
      statusCode = 401;
      errorMessage = 'Clover access token has expired. Please re-authenticate with Clover.';
    } else if (error.message.includes('No Clover merchant ID')) {
      statusCode = 400;
      errorMessage = 'No Clover merchant ID associated with this account';
    } else if (error.message.includes('Merchant not found')) {
      statusCode = 404;
      errorMessage = 'Merchant account not found';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      enabled: syncService.isEnabled(),
      processed: 0,
      inserted: 0,
      updated: 0,
      marked_for_delete: 0,
      unmatched: 0,
      errors: [errorMessage],
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;