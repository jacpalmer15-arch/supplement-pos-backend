// ==================================================
// FILE: routes/inventory.js
// ==================================================
const express = require('express');
const db = require('../config/database');
const router = express.Router();

// GET /api/inventory - Get current inventory levels
router.get('/', async (req, res) => {
    try {
        const client = await db.connect();
        
        const result = await client.query(`
            SELECT 
                p.name as product_name,
                s.sku,
                s.name_suffix,
                i.on_hand,
                i.reserved,
                i.reorder_level,
                i.last_updated,
                CASE 
                    WHEN i.on_hand <= 0 THEN 'OUT_OF_STOCK'
                    WHEN i.on_hand <= i.reorder_level THEN 'LOW_STOCK'
                    ELSE 'IN_STOCK'
                END as status
            FROM inventory i
            JOIN skus s ON s.id = i.sku_id
            JOIN products p ON p.id = s.product_id
            WHERE p.active = true AND s.active = true
            ORDER BY p.name, s.name_suffix
        `);
        
        client.release();
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/inventory/low-stock - Get items with low stock
router.get('/low-stock', async (req, res) => {
    try {
        const client = await db.connect();
        
        const result = await client.query(`
            SELECT 
                p.name as product_name,
                s.sku,
                s.name_suffix,
                i.on_hand,
                i.reorder_level
            FROM inventory i
            JOIN skus s ON s.id = i.sku_id
            JOIN products p ON p.id = s.product_id
            WHERE i.on_hand <= i.reorder_level 
            AND p.active = true 
            AND s.active = true
            ORDER BY i.on_hand ASC
        `);
        
        client.release();
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
