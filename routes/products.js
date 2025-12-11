// routes/products.js
const express = require('express');
const productService = require('../services/productService');
const router = express.Router();

// GET /api/products - with filters: search, categoryId, visibleInKiosk
router.get('/', async (req, res) => {
  try {
    const { search, categoryId, visibleInKiosk } = req.query;
    const merchantId = req.merchant.id;

    // Parse boolean parameter
    let visibleInKioskBool = null;
    if (visibleInKiosk !== undefined) {
      visibleInKioskBool = visibleInKiosk === 'true';
    }

    const data = await productService.getProductsWithFilters({
      search: search || '',
      categoryId: categoryId || null,
      visibleInKiosk: visibleInKioskBool,
      merchantId
    });

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products/:id - fetch single product
router.get('/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const merchantId = req.merchant.id;

    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product ID format' });
    }

    const product = await productService.getProductById(productId, merchantId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({ success: true, data: product });
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products - create product
router.post('/', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const productData = req.body;

    // Validate required fields
    const requiredFields = ['name', 'price_cents'];
    const missingFields = requiredFields.filter(field => !productData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate price_cents is a positive integer
    if (!Number.isInteger(productData.price_cents) || productData.price_cents < 0) {
      return res.status(400).json({
        success: false,
        error: 'price_cents must be a non-negative integer'
      });
    }

    const newProduct = await productService.createProduct(productData, merchantId);
    res.status(201).json({ success: true, data: newProduct });
  } catch (err) {
    console.error('Error creating product:', err);
    if (err.code === '23505') { // Unique constraint violation
      res.status(409).json({ success: false, error: 'Product with this SKU or UPC already exists' });
    } else if (err.code === '23503') { // Foreign key constraint violation
      res.status(400).json({ success: false, error: 'Invalid category_id' });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// PATCH /api/products/:id - update editable fields
router.patch('/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const merchantId = req.merchant.id;
    const updateData = req.body;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product ID format' });
    }

    // Validate price_cents if provided
    if (updateData.price_cents !== undefined) {
      if (!Number.isInteger(updateData.price_cents) || updateData.price_cents < 0) {
        return res.status(400).json({
          success: false,
          error: 'price_cents must be a non-negative integer'
        });
      }
    }

    const updatedProduct = await productService.updateProduct(productId, updateData, merchantId);
    if (!updatedProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({ success: true, data: updatedProduct });
  } catch (err) {
    console.error('Error updating product:', err);
    if (err.code === '23505') {
      res.status(409).json({ success: false, error: 'Product with this SKU or UPC already exists' });
    } else if (err.code === '23503') {
      res.status(400).json({ success: false, error: 'Invalid category_id' });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// DELETE /api/products/:id - delete product (with restrict if referenced by orders)
router.delete('/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const merchantId = req.merchant.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product ID format' });
    }

    const result = await productService.deleteProduct(productId, merchantId);
    if (!result.success) {
      if (result.error === 'Product not found') {
        return res.status(404).json({ success: false, error: result.error });
      } else if (result.error.includes('referenced')) {
        return res.status(409).json({ success: false, error: result.error });
      } else {
        return res.status(400).json({ success: false, error: result.error });
      }
    }

    res.json({ success: true, message: 'Product deleted successfully', data: result.deletedProduct });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Legacy endpoints for backward compatibility (maintain existing functionality)
// POST /api/products/sync  -> full backfill every time
router.post('/sync', async (req, res) => {
  try {
    const limit = Number.isFinite(+req.query.limit) ? +req.query.limit : 100;
    const result = await productService.syncAllProducts({ limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Product sync error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/sync-orders - Orders sync endpoint
router.post('/sync-orders', async (req, res) => {
  const merchantId = req.merchant.id;
  
  if (!merchantId) {
    return res.status(400).json({
      success: false,
      error: 'Merchant ID not found in request context'
    });
  }

  try {
    // Import required services
    const syncService = require('../services/syncService');
    const orderService = require('../services/orderService');
    const db = require('../config/database');

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
      enabled: true,
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

// GET /api/products/search/:query (simple convenience route)
router.get('/search/:query', async (req, res) => {
  try {
    const q = (req.params.query || '').trim();
    const merchantId = req.merchant.id;
    
    const data = await productService.getProductsWithFilters({ 
      search: q, 
      merchantId 
    });
    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
