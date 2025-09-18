const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireMerchant } = require('../middleware/auth');
const router = express.Router();

// GET /api/categories - list all categories for the merchant
router.get('/', authenticateToken, requireMerchant, async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const result = await db.query(
      `SELECT id, name, sort_order, active FROM categories WHERE merchant_id = $1 ORDER BY sort_order, name`,
      [merchantId]
    );
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/categories - create a new category
router.post('/', authenticateToken, requireMerchant, async (req, res) => {
  try {
    const { name, sort_order, active = true } = req.body;
    const merchantId = req.merchant.id;
    if (!name) return res.status(400).json({ success: false, error: "Name required" });
    const result = await db.query(
      `INSERT INTO categories (id, merchant_id, name, sort_order, active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING id, name, sort_order, active`,
      [merchantId, name, sort_order, active]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/categories/:id - update a category
router.patch('/:id', authenticateToken, requireMerchant, async (req, res) => {
  try {
    const { name, sort_order, active } = req.body;
    const merchantId = req.merchant.id;
    const categoryId = req.params.id;
    const result = await db.query(
      `UPDATE categories SET
         name = COALESCE($1, name),
         sort_order = COALESCE($2, sort_order),
         active = COALESCE($3, active)
       WHERE id = $4 AND merchant_id = $5
       RETURNING id, name, sort_order, active`,
      [name, sort_order, active, categoryId, merchantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/categories/:id - delete a category
router.delete('/:id', authenticateToken, requireMerchant, async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const categoryId = req.params.id;
    const result = await db.query(
      `DELETE FROM categories WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [categoryId, merchantId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;