// ==================================================
// FILE: routes/checkout.js
// ==================================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const cloverService = require('../services/cloverService');
const router = express.Router();

// POST /api/checkout - Process a complete checkout
router.post('/', async (req, res) => {
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        const { orderCart } = req.body;
        
        if (!orderCart || !orderCart.lineItems || orderCart.lineItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Cart is empty'
            });
        }
        
        // Generate unique external ID for this transaction
        const externalId = uuidv4();
        
        console.log(`Starting checkout for external ID: ${externalId}`);
        
        // Get merchant info
        const merchantResult = await client.query(
            'SELECT id FROM merchants WHERE clover_merchant_id = $1',
            [process.env.CLOVER_MERCHANT_ID]
        );
        
        if (merchantResult.rows.length === 0) {
            throw new Error('Merchant not found');
        }
        
        const merchantId = merchantResult.rows[0].id;
        
        // Create order in Clover using atomic_order endpoint
        const cloverOrderPayload = { orderCart };
        
        const cloverOrder = await cloverService.createOrderAtomic(cloverOrderPayload);
        
        // Calculate totals from Clover response
        const totalCents = cloverOrder.total || 0;
        
        // Calculate subtotal and tax from line items
        let subtotalCents = 0;
        let taxCents = 0;
        
        if (cloverOrder.lineItems && cloverOrder.lineItems.elements) {
            for (const lineItem of cloverOrder.lineItems.elements) {
                subtotalCents += lineItem.price || 0;
                
                // Calculate tax for this line item
                if (lineItem.taxRates && lineItem.taxRates.elements) {
                    for (const taxRate of lineItem.taxRates.elements) {
                        const itemTax = Math.round((lineItem.price * taxRate.rate) / 1000000);
                        taxCents += itemTax;
                    }
                }
            }
        }
        
        // Create transaction record
        const transactionResult = await client.query(`
            INSERT INTO transactions (
                merchant_id, external_id, clover_order_id, subtotal_cents, 
                tax_cents, total_cents, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING id
        `, [
            merchantId,
            externalId,
            cloverOrder.id,
            subtotalCents,
            taxCents,
            totalCents,
            cloverOrder.state || 'OPEN'
        ]);
        
        const transactionId = transactionResult.rows[0].id;
        
        // Create transaction items from Clover line items
        if (cloverOrder.lineItems && cloverOrder.lineItems.elements) {
            for (const lineItem of cloverOrder.lineItems.elements) {
                await client.query(`
                    INSERT INTO transaction_items (
                        transaction_id, clover_line_item_id, clover_item_id, 
                        product_name, variant_info, quantity, unit_price_cents, 
                        discount_cents, line_total_cents, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                `, [
                    transactionId,
                    lineItem.id,
                    lineItem.item?.id || null,
                    lineItem.name || '',
                    lineItem.alternateName || '',
                    1, // Default quantity to 1 if not specified
                    lineItem.price || 0,
                    0, // No discount tracking for now
                    lineItem.price || 0
                ]);
            }
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            data: {
                transactionId,
                externalId,
                cloverOrderId: cloverOrder.id,
                subtotalCents,
                taxCents,
                totalCents,
                status: cloverOrder.state || 'OPEN',
                cloverOrder
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Checkout error:', error);
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// GET /api/checkout/status/:externalId - Check payment status
router.get('/status/:externalId', async (req, res) => {
    try {
        const { externalId } = req.params;
        
        const client = await db.connect();
        
        const result = await client.query(
            'SELECT * FROM transactions WHERE external_id = $1',
            [externalId]
        );
        
        client.release();
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
