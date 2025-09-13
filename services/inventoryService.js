// services/inventoryService.js
const db = require('../config/database');

class InventoryService {
  /**
   * Get all inventory items with optional filters
   */
  async getInventory(merchantId, options = {}) {
    const { lowStockOnly } = options;
    const client = await db.connect();
    
    try {
      let query = `
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
        WHERE p.active = true AND p.merchant_id = $1
      `;

      const params = [merchantId];
      
      // Add lowStockOnly filter if requested
      if (lowStockOnly === true || lowStockOnly === 'true') {
        query += ` AND COALESCE(i.on_hand, 0) <= COALESCE(i.reorder_level, 5)`;
      }
      
      query += ` ORDER BY p.name, p.name_suffix NULLS LAST`;

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get low stock items for a merchant
   */
  async getLowStockItems(merchantId) {
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
        WHERE p.active = true AND p.merchant_id = $1
          AND i.on_hand <= i.reorder_level
        ORDER BY i.on_hand ASC, p.name
      `, [merchantId]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Update inventory levels for a product
   */
  async updateInventory(productId, merchantId, updates) {
    const { on_hand, reorder_level } = updates;
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');

      // First, verify the product exists and belongs to the merchant
      const productCheck = await client.query(
        'SELECT id FROM products WHERE id = $1 AND merchant_id = $2 AND active = true',
        [productId, merchantId]
      );

      if (productCheck.rows.length === 0) {
        throw new Error('Product not found');
      }

      // Build dynamic update query
      const updateFields = [];
      const values = [productId];
      let paramCount = 2;

      if (on_hand !== undefined) {
        updateFields.push(`on_hand = $${paramCount}`);
        values.push(on_hand);
        paramCount++;
      }

      if (reorder_level !== undefined) {
        updateFields.push(`reorder_level = $${paramCount}`);
        values.push(reorder_level);
        paramCount++;
      }

      updateFields.push('last_updated = NOW()');
      updateFields.push('sync_source = \'manual\'');

      // Create proper INSERT ON CONFLICT query
      let insertValues = [productId];
      if (on_hand !== undefined) {
        insertValues.push(on_hand);
      } else {
        insertValues.push(0); // default on_hand
      }
      insertValues.push(0); // reserved (default)
      
      if (reorder_level !== undefined) {
        insertValues.push(reorder_level);
      } else {
        insertValues.push(5); // default reorder_level
      }

      const upsertQuery = `
        INSERT INTO inventory (product_id, on_hand, reserved, reorder_level, last_updated, sync_source)
        VALUES ($1, $2, $3, $4, NOW(), 'manual')
        ON CONFLICT (product_id) DO UPDATE
        SET ${updateFields.join(', ')}
        RETURNING product_id, on_hand, reserved, reorder_level, last_updated
      `;

      const result = await client.query(upsertQuery, insertValues);

      await client.query('COMMIT');

      // Return updated inventory with product info
      return await this.getInventoryByProductId(productId, merchantId);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get inventory info for a specific product
   */
  async getInventoryByProductId(productId, merchantId) {
    const client = await db.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          p.id                 AS product_id,
          p.name               AS product_name,
          p.sku,
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
        WHERE p.id = $1 AND p.merchant_id = $2 AND p.active = true
      `, [productId, merchantId]);

      return result.rows.length > 0 ? result.rows[0] : null;
    } finally {
      client.release();
    }
  }

  /**
   * Adjust inventory levels (add/subtract from current levels)
   */
  async adjustInventory(productId, merchantId, adjustments) {
    const { on_hand_delta } = adjustments;
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');

      // Get current inventory
      const current = await client.query(
        'SELECT on_hand FROM inventory WHERE product_id = $1',
        [productId]
      );

      if (current.rows.length === 0) {
        throw new Error('Inventory record not found');
      }

      const currentOnHand = current.rows[0].on_hand || 0;
      const newOnHand = Math.max(0, currentOnHand + on_hand_delta); // Don't allow negative inventory

      // Update inventory
      await client.query(
        `UPDATE inventory 
         SET on_hand = $1, last_updated = NOW(), sync_source = 'adjustment'
         WHERE product_id = $2`,
        [newOnHand, productId]
      );

      await client.query('COMMIT');

      return await this.getInventoryByProductId(productId, merchantId);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new InventoryService();