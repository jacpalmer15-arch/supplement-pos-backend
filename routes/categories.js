// routes/categories.js
const express = require('express');
const db = require('../config/database');
const router = express.Router();

// GET /api/categories - List all categories for the authenticated merchant
router.get('/', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const client = await db.connect();

    try {
      const result = await client.query(`
        SELECT id, name, sort_order, active, created_at, updated_at,
               clover_category_id
        FROM categories 
        WHERE merchant_id = $1 
        ORDER BY sort_order ASC, name ASC
      `, [merchantId]);

      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/categories/:id - Get single category
router.get('/:id', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const categoryId = req.params.id;
    const client = await db.connect();

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(categoryId)) {
      return res.status(400).json({ success: false, error: 'Invalid category ID format' });
    }

    try {
      const result = await client.query(`
        SELECT id, name, sort_order, active, created_at, updated_at,
               clover_id, clover_created_at, clover_modified_at
        FROM categories 
        WHERE id = $1 AND merchant_id = $2
      `, [categoryId, merchantId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Category not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/categories - Create new category
router.post('/', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const { name, sort_order = 0, active = true } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required and must be a non-empty string'
      });
    }

    if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0)) {
      return res.status(400).json({
        success: false,
        error: 'sort_order must be a non-negative integer'
      });
    }

    const client = await db.connect();

    try {
      const result = await client.query(`
        INSERT INTO categories (merchant_id, name, sort_order, active)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, sort_order, active, created_at, updated_at
      `, [merchantId, name.trim(), sort_order, active]);

      res.status(201).json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ success: false, error: 'Category with this name already exists' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// PATCH /api/categories/:id - Update category
router.patch('/:id', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const categoryId = req.params.id;
    const { name, sort_order, active } = req.body;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(categoryId)) {
      return res.status(400).json({ success: false, error: 'Invalid category ID format' });
    }

    // Validate fields if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'name must be a non-empty string'
      });
    }

    if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0)) {
      return res.status(400).json({
        success: false,
        error: 'sort_order must be a non-negative integer'
      });
    }

    if (active !== undefined && typeof active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'active must be a boolean value'
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [categoryId, merchantId];
    let paramIndex = 3;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      values.push(sort_order);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields provided for update'
      });
    }

    const client = await db.connect();

    try {
      const result = await client.query(`
        UPDATE categories 
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND merchant_id = $2
        RETURNING id, name, sort_order, active, created_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Category not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating category:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ success: false, error: 'Category with this name already exists' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// DELETE /api/categories/:id - Delete category
router.delete('/:id', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const categoryId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(categoryId)) {
      return res.status(400).json({ success: false, error: 'Invalid category ID format' });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Check if category has products
      const productCheck = await client.query(
        'SELECT COUNT(*) as count FROM products WHERE category_id = $1 AND merchant_id = $2',
        [categoryId, merchantId]
      );

      if (parseInt(productCheck.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          error: 'Cannot delete category that contains products. Move or delete products first.'
        });
      }

      // Delete the category
      const result = await client.query(`
        DELETE FROM categories 
        WHERE id = $1 AND merchant_id = $2
        RETURNING id, name
      `, [categoryId, merchantId]);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Category not found' });
      }

      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Category deleted successfully',
        data: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
