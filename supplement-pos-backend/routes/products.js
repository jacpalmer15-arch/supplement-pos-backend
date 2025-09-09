const express = require('express');
const productService = require('../services/productService');
const router = express.Router();

// GET /api/products - Get products for iPad
router.get('/', async (req, res) => {
    try {
        const { search, category, kiosk_only } = req.query;
        
        if (kiosk_only === 'true') {
            const products = await productService.getProductsForKiosk(search, category);
            res.json({
                success: true,
                data: products,
                count: products.length
            });
        } else {
            // Return all products (for admin interface)
            res.json({ message: 'Admin product list not implemented yet' });
        }
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/products/sync - Sync products from Clover
router.post('/sync', async (req, res) => {
    try {
        console.log('🔄 Manual product sync requested');
        const result = await productService.syncAllProducts();
        
        res.json({
            success: true,
            message: 'Product sync completed successfully',
            data: result
        });
    } catch (error) {
        console.error('Product sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/products/search/:query - Search products by barcode or name  
router.get('/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const products = await productService.getProductsForKiosk(query);
        
        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
