// routes/orders.js
const express = require('express');
const db = require('../config/database');
const router = express.Router();

// GET /api/orders - List orders with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const { 
      status, 
      payment_status,
      start_date,
      end_date,
      page = 1, 
      limit = 50,
      search
    } = req.query;

    const client = await db.connect();

    try {
      // Build dynamic query
      const conditions = ['o.merchant_id = $1'];
      const values = [merchantId];
      let paramIndex = 2;

      if (status) {
        conditions.push(`o.status = $${paramIndex++}`);
        values.push(status);
      }

      if (payment_status) {
        conditions.push(`o.payment_status = $${paramIndex++}`);
        values.push(payment_status);
      }

      if (start_date) {
        conditions.push(`o.order_date >= $${paramIndex++}`);
        values.push(start_date);
      }

      if (end_date) {
        conditions.push(`o.order_date <= $${paramIndex++}`);
        values.push(end_date);
      }

      if (search) {
        conditions.push(`(o.order_number ILIKE $${paramIndex++} OR o.customer_name ILIKE $${paramIndex++} OR o.customer_email ILIKE $${paramIndex++})`);
        values.push(`%${search}%`, `%${search}%`, `%${search}%`);
        paramIndex += 2; // Added 2 more search params
      }

      // Calculate offset
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      // Add pagination
      conditions.push(`LIMIT $${paramIndex++} OFFSET $${paramIndex++}`);
      values.push(parseInt(limit), offset);

      const whereClause = conditions.slice(0, -1).join(' AND '); // Exclude LIMIT/OFFSET from WHERE
      const limitOffsetClause = conditions.slice(-1)[0]; // Get LIMIT/OFFSET

      const query = `
        SELECT 
          o.id, o.order_number, o.status, o.payment_status,
          o.customer_name, o.customer_email, o.customer_phone,
          o.subtotal_cents, o.tax_cents, o.discount_cents, o.total_cents,
          o.payment_method, o.order_date, o.completed_at, o.created_at,
          o.source, o.device_serial,
          COUNT(oi.id) as item_count,
          SUM(oi.quantity) as total_quantity
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE ${whereClause}
        GROUP BY o.id, o.order_number, o.status, o.payment_status,
                 o.customer_name, o.customer_email, o.customer_phone,
                 o.subtotal_cents, o.tax_cents, o.discount_cents, o.total_cents,
                 o.payment_method, o.order_date, o.completed_at, o.created_at,
                 o.source, o.device_serial
        ORDER BY o.order_date DESC, o.created_at DESC
        ${limitOffsetClause}
      `;

      const result = await client.query(query, values.slice(0, -2).concat(values.slice(-2)));

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(DISTINCT o.id) as total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, values.slice(0, -2));

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].total),
          pages: Math.ceil(countResult.rows[0].total / parseInt(limit))
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orders/:id - Get single order with items
router.get('/:id', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const orderId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID format' });
    }

    const client = await db.connect();

    try {
      // Get order details
      const orderResult = await client.query(`
        SELECT 
          id, order_number, status, payment_status, external_id,
          customer_name, customer_email, customer_phone,
          subtotal_cents, tax_cents, discount_cents, total_cents,
          payment_method, payment_reference,
          order_date, completed_at, cancelled_at, created_at, updated_at,
          source, device_serial
        FROM orders
        WHERE id = $1 AND merchant_id = $2
      `, [orderId, merchantId]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const order = orderResult.rows[0];

      // Get order items
      const itemsResult = await client.query(`
        SELECT 
          oi.id, oi.product_id, oi.product_name, oi.product_sku, 
          oi.variant_info, oi.quantity, oi.unit_price_cents, oi.line_total_cents,
          p.name as current_product_name, p.active as product_active
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id AND p.merchant_id = $2
        WHERE oi.order_id = $1
        ORDER BY oi.created_at
      `, [orderId, merchantId]);

      order.items = itemsResult.rows;

      res.json({ success: true, data: order });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/orders/:id/status - Update order status
router.patch('/:id/status', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const orderId = req.params.id;
    const { status, payment_status } = req.body;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID format' });
    }

    // Validate status values
    const validStatuses = ['pending', 'processing', 'completed', 'cancelled', 'refunded'];
    const validPaymentStatuses = ['unpaid', 'paid', 'partially_paid', 'refunded'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid payment_status. Must be one of: ${validPaymentStatuses.join(', ')}`
      });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Build update query
      const updates = [];
      const values = [orderId, merchantId];
      let paramIndex = 3;

      if (status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(status);
        
        // Set completion/cancellation timestamps
        if (status === 'completed') {
          updates.push(`completed_at = NOW()`);
        } else if (status === 'cancelled') {
          updates.push(`cancelled_at = NOW()`);
        }
      }

      if (payment_status !== undefined) {
        updates.push(`payment_status = $${paramIndex++}`);
        values.push(payment_status);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'No valid status updates provided'
        });
      }

      const result = await client.query(`
        UPDATE orders 
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND merchant_id = $2
        RETURNING id, order_number, status, payment_status, completed_at, cancelled_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      await client.query('COMMIT');

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orders/stats/summary - Get order statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const { start_date, end_date } = req.query;

    const client = await db.connect();

    try {
      // Build date filter
      let dateFilter = '';
      const values = [merchantId];
      let paramIndex = 2;

      if (start_date && end_date) {
        dateFilter = `AND order_date >= $${paramIndex++} AND order_date <= $${paramIndex++}`;
        values.push(start_date, end_date);
      } else if (start_date) {
        dateFilter = `AND order_date >= $${paramIndex++}`;
        values.push(start_date);
      } else if (end_date) {
        dateFilter = `AND order_date <= $${paramIndex++}`;
        values.push(end_date);
      }

      const statsQuery = `
        SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_cents END), 0) as total_revenue_cents,
          COALESCE(AVG(CASE WHEN status = 'completed' THEN total_cents END), 0) as average_order_value_cents,
          COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_orders,
          COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as unpaid_orders
        FROM orders
        WHERE merchant_id = $1 ${dateFilter}
      `;

      const result = await client.query(statsQuery, values);

      res.json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching order statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;