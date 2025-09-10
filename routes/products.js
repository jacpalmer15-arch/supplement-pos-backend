// routes/products.js
const express = require('express');
const productService = require('../services/productService');
const router = express.Router();

// GET /api/products
// Supports: kiosk_only=true, search, category
router.get('/', async (req, res) => {
  try {
    const { kiosk_only, search, category } = req.query;

    if (kiosk_only === 'true') {
      const data = await productService.getProductsForKiosk({
        search: search || '',
        categoryId: category || null,
      });
      return res.json({ success: true, data, count: data.length });
    }

    // Admin feed (basic for now; you can expand as needed)
    const data = await productService.getProductsForKiosk({
      search: search || '',
      categoryId: category || null,
    });
    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
    const data = await productService.getProductsForKiosk({ search: q });
    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
