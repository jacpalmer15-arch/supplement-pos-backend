// ==================================================
// FILE: routes/inventory.js
// ==================================================
const express = require('express');
const db = require('../config/database');
const router = express.Router();

// GET /api/inventory - Get current inventory levels
router.get('/', async (req, res) => {
  const client = await db.connect();
  try {
    const result = await client.query(`
      SELECT 
        p.id                 AS product_id,
        p.clover_item_id,
        p.item_group_id,
        p.name               AS product_name,
        p.sku,
        p.upc,
        p.name_suffix,
        p.size,
        p.flavor,
        p.price_cents,
        COALESCE(i.on_hand, 0)        AS on_hand,
        COALESCE(i.reserved, 0)       AS reserved,
        COALESCE(i.reorder_level, 5)  AS reorder_level,
        i.last_updated,
        CASE 
          WHEN COALESCE(i.on_hand, 0) <= 0 THEN 'OUT_OF_STOCK'
          WHEN COALESCE(i.on_hand, 0) <= COALESCE(i.reorder_level, 5) THEN 'LOW_STOCK'
          ELSE 'IN_STOCK'
        END AS status
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.active = true
      ORDER BY p.name, p.name_suffix NULLS LAST
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/inventory/low-stock - Get items with low stock
router.get('/low-stock', async (req, res) => {
  const client = await db.connect();
  try {
    const result = await client.query(`
      SELECT 
        p.id                 AS product_id,
        p.clover_item_id,
        p.name               AS product_name,
        p.sku,
        p.upc,
        p.name_suffix,
        p.size,
        p.flavor,
        i.on_hand,
        i.reorder_level,
        i.last_updated
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      WHERE p.active = true
        AND i.on_hand <= i.reorder_level
      ORDER BY i.on_hand ASC, p.name
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
