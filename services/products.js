// routes/products.js
const express = require('express');
const productService = require('../services/productService');
const router = express.Router();

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const { search, category, kiosk_only } = req.query;
    if (kiosk_only === 'true') {
      const products = await productService.getProductsForKiosk(search, category);
      return res.json({ success: true, data: products, count: products.length });
    }
    return res.json({ message: 'Admin product list not implemented yet' });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/products/sync  → full backfill every time
router.post('/sync', async (req, res) => {
  try {
    const result = await productService.syncAllProducts({ limit: 100 });
    res.json({ success: true, message: 'Full Clover backfill complete', data: result });
  } catch (error) {
    console.error('Product sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const products = await productService.getProductsForKiosk(query);
    res.json({ success: true, data: products, count: products.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
