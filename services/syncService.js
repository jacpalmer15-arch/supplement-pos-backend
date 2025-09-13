// services/syncService.js
const db = require('../config/database');
const { clover, fetchPaged } = require('./cloverService');

/**
 * Comprehensive sync service for Clover integration
 * Handles categories, products (items), and inventory sync with upsert logic
 */
class SyncService {
  constructor() {
    this.isCloverEnabled = process.env.ENABLE_CLOVER === 'true';
  }

  /**
   * Check if Clover sync is enabled
   */
  isEnabled() {
    return this.isCloverEnabled;
  }

  /**
   * Get Clover access token for a merchant
   * @param {string} merchantId - UUID of the merchant
   * @returns {Object} - Token information
   */
  async getMerchantCloverToken(merchantId) {
    const client = await db.connect();
    try {
      const result = await client.query(
        'SELECT access_token, refresh_token, expires_at FROM clover_tokens WHERE merchant_id = $1',
        [merchantId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('No Clover token found for merchant');
      }

      const tokenInfo = result.rows[0];
      
      // Check if token is expired (if expires_at is set)
      if (tokenInfo.expires_at && new Date() > new Date(tokenInfo.expires_at)) {
        throw new Error('Clover access token has expired');
      }

      return tokenInfo;
    } finally {
      client.release();
    }
  }

  /**
   * Create authenticated Clover API client for specific merchant
   * @param {string} accessToken - Merchant's Clover access token
   * @returns {Object} - Axios instance configured for Clover API
   */
  createCloverClient(accessToken) {
    const baseURL = process.env.CLOVER_BASE_URL || 
      (process.env.CLOVER_ENVIRONMENT?.toLowerCase() === 'sandbox'
        ? 'https://sandbox.dev.clover.com'
        : 'https://api.clover.com');

    const axios = require('axios');
    return axios.create({
      baseURL,
      headers: { 
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      validateStatus: s => s < 500, // surface 4xx, retry 5xx upstream if needed
    });
  }

  /**
   * Sync categories from Clover to database
   * @param {string} merchantId - UUID of the merchant
   * @param {string} accessToken - Clover access token
   * @param {string} cloverMerchantId - Clover merchant ID
   * @returns {Object} - Sync results
   */
  async syncCategories(merchantId, accessToken, cloverMerchantId) {
    const cloverClient = this.createCloverClient(accessToken);
    let processed = 0;
    let errors = [];

    const client = await db.connect();
    
    try {
      await client.query('BEGIN');
      
      const path = `/v3/merchants/${cloverMerchantId}/categories`;
      
      await fetchPaged(path, { limit: 100 }, async (categories) => {
        for (const category of categories) {
          try {
            await client.query(`
              INSERT INTO categories (
                merchant_id, clover_id, name, sort_order, active, 
                clover_created_at, clover_modified_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (merchant_id, clover_id) 
              DO UPDATE SET 
                name = EXCLUDED.name,
                sort_order = EXCLUDED.sort_order,
                active = EXCLUDED.active,
                clover_modified_at = EXCLUDED.clover_modified_at,
                updated_at = NOW()
            `, [
              merchantId,
              category.id,
              category.name || 'Unnamed Category',
              category.sortOrder || 0,
              !category.deleted,
              category.createdTime ? new Date(category.createdTime) : null,
              category.modifiedTime ? new Date(category.modifiedTime) : null
            ]);
            processed++;
          } catch (error) {
            console.error(`Error syncing category ${category.id}:`, error);
            errors.push(`Category ${category.name}: ${error.message}`);
          }
        }
      }, cloverClient);

      await client.query('COMMIT');
      
      return {
        success: true,
        processed,
        errors: errors.length > 0 ? errors : null
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Categories sync failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync products/items from Clover to database
   * @param {string} merchantId - UUID of the merchant
   * @param {string} accessToken - Clover access token
   * @param {string} cloverMerchantId - Clover merchant ID
   * @returns {Object} - Sync results
   */
  async syncProducts(merchantId, accessToken, cloverMerchantId) {
    const cloverClient = this.createCloverClient(accessToken);
    let processed = 0;
    let errors = [];

    const client = await db.connect();
    
    try {
      await client.query('BEGIN');
      
      const path = `/v3/merchants/${cloverMerchantId}/items`;
      
      await fetchPaged(path, { limit: 100 }, async (items) => {
        for (const item of items) {
          try {
            // Find category mapping if exists
            let categoryId = null;
            if (item.categories && item.categories.elements && item.categories.elements.length > 0) {
              const cloverCategoryId = item.categories.elements[0].id;
              const categoryResult = await client.query(
                'SELECT id FROM categories WHERE merchant_id = $1 AND clover_id = $2',
                [merchantId, cloverCategoryId]
              );
              if (categoryResult.rows.length > 0) {
                categoryId = categoryResult.rows[0].id;
              }
            }

            await client.query(`
              INSERT INTO products (
                merchant_id, clover_id, name, description, price_cents, sku, upc,
                category_id, visible_in_kiosk, brand, active,
                clover_created_at, clover_modified_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (merchant_id, clover_id) 
              DO UPDATE SET 
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                price_cents = EXCLUDED.price_cents,
                sku = EXCLUDED.sku,
                upc = EXCLUDED.upc,
                category_id = EXCLUDED.category_id,
                visible_in_kiosk = EXCLUDED.visible_in_kiosk,
                brand = EXCLUDED.brand,
                active = EXCLUDED.active,
                clover_modified_at = EXCLUDED.clover_modified_at,
                updated_at = NOW()
            `, [
              merchantId,
              item.id,
              item.name || 'Unnamed Product',
              item.alternateName || null,
              item.price || 0,
              item.code || null,
              item.sku || null,
              categoryId,
              !item.hidden,
              null, // Clover doesn't have brand field in basic item
              !item.deleted,
              item.createdTime ? new Date(item.createdTime) : null,
              item.modifiedTime ? new Date(item.modifiedTime) : null
            ]);
            processed++;
          } catch (error) {
            console.error(`Error syncing product ${item.id}:`, error);
            errors.push(`Product ${item.name}: ${error.message}`);
          }
        }
      }, cloverClient);

      await client.query('COMMIT');
      
      return {
        success: true,
        processed,
        errors: errors.length > 0 ? errors : null
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Products sync failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync inventory from Clover to database
   * @param {string} merchantId - UUID of the merchant
   * @param {string} accessToken - Clover access token
   * @param {string} cloverMerchantId - Clover merchant ID
   * @returns {Object} - Sync results
   */
  async syncInventory(merchantId, accessToken, cloverMerchantId) {
    const cloverClient = this.createCloverClient(accessToken);
    let processed = 0;
    let errors = [];

    const client = await db.connect();
    
    try {
      await client.query('BEGIN');
      
      const path = `/v3/merchants/${cloverMerchantId}/item_stocks`;
      
      await fetchPaged(path, { limit: 100 }, async (stocks) => {
        for (const stock of stocks) {
          try {
            // Find the corresponding product
            const productResult = await client.query(
              'SELECT id FROM products WHERE merchant_id = $1 AND clover_id = $2',
              [merchantId, stock.item.id]
            );

            if (productResult.rows.length === 0) {
              console.warn(`Product not found for inventory item ${stock.item.id}`);
              continue;
            }

            const productId = productResult.rows[0].id;
            const quantity = stock.quantity || 0;
            const stockType = stock.stockCount ? 'stockCount' : 'quantity';

            await client.query(`
              INSERT INTO inventory (
                merchant_id, product_id, clover_item_id, quantity_available, 
                low_stock_threshold, auto_order_enabled,
                clover_modified_at, sync_status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (merchant_id, product_id) 
              DO UPDATE SET 
                quantity_available = EXCLUDED.quantity_available,
                clover_modified_at = EXCLUDED.clover_modified_at,
                sync_status = EXCLUDED.sync_status,
                updated_at = NOW()
            `, [
              merchantId,
              productId,
              stock.item.id,
              quantity,
              10, // Default low stock threshold
              false, // Default auto order disabled
              stock.modifiedTime ? new Date(stock.modifiedTime) : null,
              'synced'
            ]);
            processed++;
          } catch (error) {
            console.error(`Error syncing inventory for item ${stock.item?.id}:`, error);
            errors.push(`Inventory ${stock.item?.id}: ${error.message}`);
          }
        }
      }, cloverClient);

      await client.query('COMMIT');
      
      return {
        success: true,
        processed,
        errors: errors.length > 0 ? errors : null
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Inventory sync failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform full sync from Clover (categories, products, inventory)
   * @param {string} merchantId - UUID of the merchant
   * @returns {Object} - Complete sync results
   */
  async performFullSync(merchantId) {
    if (!this.isEnabled()) {
      return {
        success: true,
        message: 'Clover sync is disabled',
        enabled: false,
        categories: { processed: 0 },
        products: { processed: 0 },
        inventory: { processed: 0 }
      };
    }

    try {
      console.log(`Starting full Clover sync for merchant ${merchantId}`);
      
      // Get merchant's Clover token and merchant ID
      const tokenInfo = await this.getMerchantCloverToken(merchantId);
      
      // Get the clover merchant ID from the merchants table
      const client = await db.connect();
      let cloverMerchantId;
      try {
        const merchantResult = await client.query(
          'SELECT clover_merchant_id FROM merchants WHERE id = $1',
          [merchantId]
        );
        if (merchantResult.rows.length === 0) {
          throw new Error('Merchant not found');
        }
        cloverMerchantId = merchantResult.rows[0].clover_merchant_id;
      } finally {
        client.release();
      }

      if (!cloverMerchantId) {
        throw new Error('No Clover merchant ID associated with this merchant');
      }

      // Perform sync in sequence: categories first, then products, then inventory
      const startTime = new Date();
      
      const categoriesResult = await this.syncCategories(merchantId, tokenInfo.access_token, cloverMerchantId);
      const productsResult = await this.syncProducts(merchantId, tokenInfo.access_token, cloverMerchantId);
      const inventoryResult = await this.syncInventory(merchantId, tokenInfo.access_token, cloverMerchantId);
      
      const endTime = new Date();
      const duration = endTime - startTime;

      console.log(`Full Clover sync completed in ${duration}ms for merchant ${merchantId}`);

      return {
        success: true,
        message: 'Full sync completed successfully',
        enabled: true,
        duration: `${duration}ms`,
        categories: categoriesResult,
        products: productsResult,
        inventory: inventoryResult,
        timestamp: endTime.toISOString()
      };
    } catch (error) {
      console.error(`Full sync failed for merchant ${merchantId}:`, error);
      
      // Return structured error response
      return {
        success: false,
        error: error.message,
        enabled: true,
        categories: { processed: 0, errors: [error.message] },
        products: { processed: 0 },
        inventory: { processed: 0 },
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new SyncService();