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
        
        const { cart, deviceSerial } = req.body;
        
        if (!cart || !cart.items || cart.items.length === 0) {
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
        
        // Calculate totals
        let subtotalCents = 0;
        let taxCents = 0;
        
        // Validate inventory and calculate totals
        for (const item of cart.items) {
            const skuResult = await client.query(
                'SELECT s.*, i.on_hand, p.tax_rate_decimal FROM skus s LEFT JOIN inventory i ON i.sku_id = s.id JOIN products p ON p.id = s.product_id WHERE s.id = $1',
                [item.skuId]
            );
            
            if (skuResult.rows.length === 0) {
                throw new Error(`SKU not found: ${item.skuId}`);
            }
            
            const sku = skuResult.rows[0];
            
            // Check inventory
            if (sku.on_hand < item.quantity) {
                throw new Error(`Insufficient inventory for ${sku.sku}. Available: ${sku.on_hand}, Requested: ${item.quantity}`);
            }
            
            const lineTotal = sku.price_cents * item.quantity;
            const lineTax = Math.round(lineTotal * sku.tax_rate_decimal);
            
            subtotalCents += lineTotal;
            taxCents += lineTax;
        }
        
        const totalCents = subtotalCents + taxCents;
        
        // Create transaction record
        const transactionResult = await client.query(`
            INSERT INTO transactions (
                merchant_id, external_id, subtotal_cents, 
                tax_cents, total_cents, status
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [
            merchantId,
            externalId,
            subtotalCents,
            taxCents,
            totalCents,
            'PENDING'
        ]);
        
        const transactionId = transactionResult.rows[0].id;
        
        // Create transaction items
        for (const item of cart.items) {
            const skuResult = await client.query(
                'SELECT s.*, p.name, p.tax_rate_decimal FROM skus s JOIN products p ON p.id = s.product_id WHERE s.id = $1',
                [item.skuId]
            );
            
            const sku = skuResult.rows[0];
            const lineTotal = sku.price_cents * item.quantity;
            
            await client.query(`
                INSERT INTO transaction_items (
                    transaction_id, sku_id, product_name, variant_info,
                    quantity, unit_price_cents, line_total_cents
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                transactionId,
                item.skuId,
                sku.name,
                sku.name_suffix,
                item.quantity,
                sku.price_cents,
                lineTotal
            ]);
        }
        
        // Create order in Clover
        const cloverOrderData = {
            items: cart.items.map(item => ({
                item: { id: item.cloverVariantId },
                unitQty: item.quantity
            }))
        };
        
        const cloverOrder = await cloverService.createOrder(cloverOrderData);
        
        // Update transaction with Clover order ID
        await client.query(
            'UPDATE transactions SET clover_order_id = $1 WHERE id = $2',
            [cloverOrder.id, transactionId]
        );
        
        // Initiate payment on Clover Mini
        const payment = await cloverService.initiatePayment(
            cloverOrder.id,
            totalCents,
            externalId
        );
        
        // Update transaction with payment ID
        await client.query(
            'UPDATE transactions SET clover_payment_id = $1 WHERE id = $2',
            [payment.id, transactionId]
        );
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            data: {
                transactionId,
                externalId,
                cloverOrderId: cloverOrder.id,
                cloverPaymentId: payment.id,
                subtotalCents,
                taxCents,
                totalCents,
                status: 'PAYMENT_INITIATED'
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
