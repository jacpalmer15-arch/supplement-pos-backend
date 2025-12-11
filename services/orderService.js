// services/orderService.js
const db = require('../config/database');
const { fetchPaged } = require('./cloverService');

/**
 * Service for syncing Clover orders into the local database
 * Handles transactions and transaction_items tables
 */
class OrderService {
  /**
   * Sync orders from Clover for a specific merchant
   * @param {string} merchantId - UUID of the merchant
   * @param {string} accessToken - Clover access token
   * @param {string} cloverMerchantId - Clover merchant ID
   * @param {Object} options - Sync options
   * @param {number} options.limit - Page size for fetchPaged (default 100)
   * @param {boolean} options.prune - Whether to mark unmatched local transactions (default false)
   * @returns {Object} - Sync results with counts
   */
  async syncOrders(merchantId, accessToken, cloverMerchantId, { limit = 100, prune = false } = {}) {
    const startTime = new Date();
    const axios = require('axios');
    
    // Create Clover client with merchant's token
    const baseURL = process.env.CLOVER_BASE_URL?.trim() || 
      (process.env.CLOVER_ENVIRONMENT?.toLowerCase() === 'sandbox'
        ? 'https://sandbox.dev.clover.com'
        : 'https://api.clover.com');

    const cloverClient = axios.create({
      baseURL,
      headers: { 
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      validateStatus: s => s < 500,
    });

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let errors = [];
    const cloverOrderIds = new Set();

    const client = await db.connect();
    
    try {
      const path = `/v3/merchants/${cloverMerchantId}/orders`;
      const params = { expand: 'lineItems' };
      
      await fetchPaged(path, { limit, params }, async (orders) => {
        for (const order of orders) {
          try {
            await client.query('BEGIN');
            
            const cloverOrderId = order.id;
            cloverOrderIds.add(cloverOrderId);
            processed++;

            // Map order fields
            const externalId = order.externalId || null;
            
            // Calculate subtotal from line items
            let subtotalCents = 0;
            if (order.lineItems && order.lineItems.elements) {
              for (const li of order.lineItems.elements) {
                subtotalCents += li.price || 0;
              }
            }
            
            const taxCents = 0; // Not parsing tax for now
            const discountCents = 0; // Not tracking discounts for now
            const totalCents = order.total || 0;
            const status = order.state; // Use exact Clover state value
            const orderFromSc = false; // These are Clover-origin orders
            
            // Set completed_at if payment state indicates paid
            const completedAt = order.paymentState === 'PAID' ? new Date() : null;

            // Upsert transaction
            // Following checkout.js pattern but adding completed_at which we know exists from webhooks.js
            const transactionResult = await client.query(`
              INSERT INTO transactions (
                merchant_id, clover_order_id, external_id, 
                subtotal_cents, tax_cents, discount_cents, total_cents,
                status, order_from_sc, completed_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (merchant_id, clover_order_id)
              DO UPDATE SET
                external_id = EXCLUDED.external_id,
                subtotal_cents = EXCLUDED.subtotal_cents,
                tax_cents = EXCLUDED.tax_cents,
                discount_cents = EXCLUDED.discount_cents,
                total_cents = EXCLUDED.total_cents,
                status = EXCLUDED.status,
                completed_at = COALESCE(EXCLUDED.completed_at, transactions.completed_at)
              RETURNING id, (xmax = 0) AS inserted
            `, [
              merchantId,
              cloverOrderId,
              externalId,
              subtotalCents,
              taxCents,
              discountCents,
              totalCents,
              status,
              orderFromSc,
              completedAt
            ]);

            const transactionId = transactionResult.rows[0].id;
            const wasInserted = transactionResult.rows[0].inserted;
            
            if (wasInserted) {
              inserted++;
            } else {
              updated++;
            }

            // Delete existing transaction_items for idempotency
            await client.query(
              'DELETE FROM transaction_items WHERE transaction_id = $1',
              [transactionId]
            );

            // Insert transaction_items from line items
            if (order.lineItems && order.lineItems.elements) {
              for (const li of order.lineItems.elements) {
                const cloverItemId = li.item?.id || null;
                
                // Look up product_id by clover_item_id
                let productId = null;
                if (cloverItemId) {
                  const productResult = await client.query(
                    'SELECT id FROM products WHERE merchant_id = $1 AND clover_item_id = $2 LIMIT 1',
                    [merchantId, cloverItemId]
                  );
                  if (productResult.rows.length > 0) {
                    productId = productResult.rows[0].id;
                  }
                }

                const productName = li.name || null;
                const variantInfo = JSON.stringify(li.variant || li.modifier || {});
                const quantity = Number.isFinite(li.quantity) ? li.quantity : 1;
                const unitPriceCents = li.price || 0;
                const lineDiscountCents = 0; // Not tracking discounts
                const lineTotalCents = li.total || (unitPriceCents * quantity);

                await client.query(`
                  INSERT INTO transaction_items (
                    transaction_id, product_id, clover_item_id,
                    product_name, variant_info, quantity,
                    unit_price_cents, discount_cents, line_total_cents
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                  transactionId,
                  productId,
                  cloverItemId,
                  productName,
                  variantInfo,
                  quantity,
                  unitPriceCents,
                  lineDiscountCents,
                  lineTotalCents
                ]);
              }
            }

            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            console.error(`Error syncing order ${order.id}:`, error);
            errors.push(`Order ${order.id}: ${error.message}`);
          }
        }
      }, cloverClient);

      // Handle prune: mark unmatched local transactions
      let markedForDelete = 0;
      let unmatched = [];
      
      if (prune && cloverOrderIds.size > 0) {
        const cloverOrderIdArray = Array.from(cloverOrderIds);
        
        // Find local transactions not in Clover
        const unmatchedResult = await client.query(`
          SELECT id, clover_order_id
          FROM transactions
          WHERE merchant_id = $1
            AND clover_order_id IS NOT NULL
            AND clover_order_id NOT IN (${cloverOrderIdArray.map((_, i) => `$${i + 2}`).join(', ')})
            AND status != 'delete'
        `, [merchantId, ...cloverOrderIdArray]);

        unmatched = unmatchedResult.rows.map(r => r.clover_order_id);
        
        if (unmatchedResult.rows.length > 0) {
          const unmatchedIds = unmatchedResult.rows.map(r => r.id);
          
          await client.query(`
            UPDATE transactions
            SET status = 'delete'
            WHERE id IN (${unmatchedIds.map((_, i) => `$${i + 1}`).join(', ')})
          `, unmatchedIds);
          
          markedForDelete = unmatchedResult.rows.length;
        }
      } else if (!prune) {
        // When prune is false, still query for unmatched count but don't modify
        if (cloverOrderIds.size > 0) {
          const cloverOrderIdArray = Array.from(cloverOrderIds);
          const unmatchedResult = await client.query(`
            SELECT clover_order_id
            FROM transactions
            WHERE merchant_id = $1
              AND clover_order_id IS NOT NULL
              AND clover_order_id NOT IN (${cloverOrderIdArray.map((_, i) => `$${i + 2}`).join(', ')})
              AND status != 'delete'
          `, [merchantId, ...cloverOrderIdArray]);
          
          unmatched = unmatchedResult.rows.map(r => r.clover_order_id);
        }
      }

      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;

      return {
        success: true,
        enabled: true,
        processed,
        inserted,
        updated,
        marked_for_delete: markedForDelete,
        unmatched: unmatched.length,
        errors: errors.length > 0 ? errors : null,
        timestamp: endTime.toISOString(),
        duration
      };
    } catch (error) {
      console.error('Order sync failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new OrderService();
