// routes/sync.js
const express = require('express');
const syncService = require('../services/syncService');
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

module.exports = router;