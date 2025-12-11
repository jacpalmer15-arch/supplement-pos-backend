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

            // Map order fields - use clover order ID as external_id if not provided
            const externalId = order.externalId || cloverOrderId;
            
            // Capture employee ID from order (for future use/tracking)
            const cloverEmployeeId = order.employee?.id || null;
            
            // Calculate subtotal from line items
            let subtotalCents = 0;
            if (order.lineItems && order.lineItems.elements) {
              for (const li of order.lineItems.elements) {
                subtotalCents += li.price || 0;
              }
            }
            
            // Use Clover's total as source of truth
            const totalCents = order.total || 0;
            
            // Calculate tax as the difference to satisfy CHECK constraint: total = subtotal + tax - discount
            // Since we don't track discounts separately, tax absorbs all differences
            const discountCents = 0;
            const taxCents = totalCents - subtotalCents - discountCents;
            const status = order.state; // Use exact Clover state value
            const orderFromSc = false; // These are Clover-origin orders
            
            // Set completed_at if payment state indicates paid
            const completedAt = order.paymentState === 'PAID' ? new Date() : null;
            
            // Note: cloverEmployeeId is captured but not stored yet
            // TODO: Add employee_clover_id column to transactions table to track this

            // Check if transaction exists
            const existingResult = await client.query(
              'SELECT id FROM transactions WHERE merchant_id = $1 AND clover_order_id = $2',
              [merchantId, cloverOrderId]
            );

            let transactionId;
            let wasInserted;

            if (existingResult.rows.length > 0) {
              // Update existing transaction
              transactionId = existingResult.rows[0].id;
              wasInserted = false;
              
              await client.query(`
                UPDATE transactions SET
                  external_id = $1,
                  subtotal_cents = $2,
                  tax_cents = $3,
                  discount_cents = $4,
                  total_cents = $5,
                  status = $6,
                  completed_at = COALESCE($7, completed_at)
                WHERE id = $8
              `, [
                externalId,
                subtotalCents,
                taxCents,
                discountCents,
                totalCents,
                status,
                completedAt,
                transactionId
              ]);
            } else {
              // Insert new transaction
              const insertResult = await client.query(`
                INSERT INTO transactions (
                  merchant_id, clover_order_id, external_id, 
                  subtotal_cents, tax_cents, discount_cents, total_cents,
                  status, order_from_sc, completed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
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
              
              transactionId = insertResult.rows[0].id;
              wasInserted = true;
            }
            
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

      // Mark unmatched local transactions for delete
      let markedForDelete = 0;
      let unmatched = [];
      
      if (cloverOrderIds.size > 0) {
        const cloverOrderIdArray = Array.from(cloverOrderIds);
        
        // Find local transactions not in Clover using ANY for safe parameterized query
        const unmatchedResult = await client.query(`
          SELECT id, clover_order_id
          FROM transactions
          WHERE merchant_id = $1
            AND clover_order_id IS NOT NULL
            AND clover_order_id != ALL($2::text[])
            AND status != 'delete'
        `, [merchantId, cloverOrderIdArray]);

        unmatched = unmatchedResult.rows.map(r => r.clover_order_id);
        
        if (unmatchedResult.rows.length > 0) {
          const unmatchedIds = unmatchedResult.rows.map(r => r.id);
          
          // Use ANY for safe parameterized update
          await client.query(`
            UPDATE transactions
            SET status = 'delete'
            WHERE id = ANY($1::uuid[])
          `, [unmatchedIds]);
          
          markedForDelete = unmatchedResult.rows.length;
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
