// ==================================================
// FILE: routes/inventory.js
// ==================================================
const express = require('express');
const inventoryService = require('../services/inventoryService');
const router = express.Router();

// GET /api/inventory - Get current inventory levels with optional filters
router.get('/', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const { lowStockOnly } = req.query;
    
    const data = await inventoryService.getInventory(merchantId, { lowStockOnly });

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/inventory/:productId - Set/adjust on_hand and reorder_level for a product
router.patch('/:productId', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const { productId } = req.params;
    const { on_hand, reorder_level } = req.body;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid product ID format' 
      });
    }

    // Validate input parameters
    if (on_hand !== undefined && (!Number.isInteger(on_hand) || on_hand < 0)) {
      return res.status(400).json({
        success: false,
        error: 'on_hand must be a non-negative integer'
      });
    }

    if (reorder_level !== undefined && (!Number.isInteger(reorder_level) || reorder_level < 0)) {
      return res.status(400).json({
        success: false,
        error: 'reorder_level must be a non-negative integer'
      });
    }

    if (on_hand === undefined && reorder_level === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Either on_hand or reorder_level must be provided'
      });
    }

    const data = await inventoryService.updateInventory(productId, merchantId, { on_hand, reorder_level });
    
    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: 'Product not found' 
      });
    }

    res.json({
      success: true,
      data,
      message: 'Inventory updated successfully'
    });

  } catch (error) {
    console.error('Error updating inventory:', error);
    if (error.message === 'Product not found') {
      res.status(404).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// GET /api/inventory/low-stock - Get items with low stock (kept for backward compatibility)
router.get('/low-stock', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const data = await inventoryService.getLowStockItems(merchantId);

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
