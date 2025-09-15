// routes/products.js
const express = require('express');
const productService = require('../services/productService');
const { authenticateToken } = require('../src/middleware/auth');
const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/products - with filters: search, categoryId, visibleInKiosk
router.get('/', async (req, res) => {
  try {
    const { search, categoryId, visibleInKiosk } = req.query;
    const merchantId = req.user.merchantId;

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
    const merchantId = req.user.merchantId;

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
    const merchantId = req.user.merchantId;
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
    const merchantId = req.user.merchantId;
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
    const merchantId = req.user.merchantId;

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

// GET /api/products/search/:query (simple convenience route)
router.get('/search/:query', async (req, res) => {
  try {
    const q = (req.params.query || '').trim();
    const merchantId = req.user.merchantId;
    
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
