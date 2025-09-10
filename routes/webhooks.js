// routes/webhooks.js - Clover Webhook Handlers
const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const router = express.Router();

// Middleware to parse raw body back to JSON for webhook processing
router.use((req, res, next) => {
    if (req.body && Buffer.isBuffer(req.body)) {
        try {
            // Convert raw buffer back to JSON object
            req.body = JSON.parse(req.body.toString('utf8'));
        } catch (error) {
            console.error('Failed to parse webhook body:', error);
            return res.status(400).json({ error: 'Invalid JSON in request body' });
        }
    }
    next();
});

// Webhook signature verification middleware (for production security)
function verifyWebhookSignature(req, res, next) {
    if (process.env.NODE_ENV !== 'production') {
        console.log('Skipping webhook signature verification in development');
        return next();
    }
    
    const signature = req.headers['x-clover-hmac-sha256'];
    if (!signature) {
        console.error('Missing webhook signature header');
        return res.status(401).json({ error: 'Missing signature header' });
    }
    
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
        .createHmac('sha256', process.env.CLOVER_APP_SECRET)
        .update(rawBody)
        .digest('base64');
    
    if (signature !== expectedSignature) {
        console.error('Invalid webhook signature');
        console.log('Expected:', expectedSignature);
        console.log('Received:', signature);
        return res.status(401).json({ error: 'Invalid signature' });
    }
    
    console.log('Webhook signature verified successfully');
    next();
}

// Apply signature verification to all webhook routes
router.use(verifyWebhookSignature);

// POST /webhooks/inventory - Handle inventory updates from Clover
router.post('/inventory', async (req, res) => {
    try {
        console.log('Received inventory webhook:', JSON.stringify(req.body, null, 2));
        
        const { appId, merchants } = req.body;
        
        if (!merchants || merchants.length === 0) {
            console.log('No merchant data in webhook');
            return res.status(400).json({ error: 'No merchant data in webhook' });
        }
        
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const merchant of merchants) {
                const { mId, items } = merchant;
                
                console.log(`Processing inventory update for merchant ${mId}`);
                
                if (!items || items.length === 0) {
                    console.log('No items in merchant data, skipping');
                    continue;
                }
                
                for (const item of items) {
                    console.log(`Updating inventory for item ${item.id}: ${item.stockCount}`);
                    
                    // Update inventory for this item
                    const updateResult = await client.query(`
                        UPDATE inventory 
                        SET on_hand = $1, last_updated = NOW(), sync_source = 'webhook'
                        FROM skus s 
                        WHERE inventory.sku_id = s.id 
                        AND s.clover_variant_id = $2
                        RETURNING inventory.sku_id, inventory.on_hand
                    `, [
                        item.stockCount || 0,
                        item.id
                    ]);
                    
                    if (updateResult.rows.length > 0) {
                        console.log(`Successfully updated inventory for item ${item.id}: ${item.stockCount}`);
                    } else {
                        console.log(`No matching SKU found for Clover item ${item.id}`);
                    }
                }
            }
            
            await client.query('COMMIT');
            
            // Log the webhook for audit trail
            try {
                await client.query(`
                    INSERT INTO audit_logs (
                        merchant_id, action, entity_type, new_values
                    ) VALUES (
                        (SELECT id FROM merchants WHERE clover_merchant_id = $1),
                        'INVENTORY_WEBHOOK_RECEIVED',
                        'INVENTORY',
                        $2
                    )
                `, [
                    merchants[0].mId,
                    JSON.stringify(req.body)
                ]);
            } catch (auditError) {
                console.error('Failed to log webhook audit:', auditError.message);
                // Don't fail the webhook for audit logging issues
            }
            
            res.json({ 
                success: true, 
                message: 'Inventory updated successfully',
                processed_merchants: merchants.length,
                processed_items: merchants.reduce((total, m) => total + (m.items?.length || 0), 0)
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Inventory webhook error:', error);
        res.status(500).json({ 
            error: 'Failed to process inventory webhook',
            message: error.message 
        });
    }
});

// POST /webhooks/payments - Handle payment updates from Clover  
router.post('/payments', async (req, res) => {
    try {
        console.log('Received payment webhook:', JSON.stringify(req.body, null, 2));
        
        const { appId, merchants } = req.body;
        
        if (!merchants || merchants.length === 0) {
            console.log('No merchant data in payment webhook');
            return res.status(400).json({ error: 'No merchant data in webhook' });
        }
        
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const merchant of merchants) {
                const { mId, payments } = merchant;
                
                console.log(`Processing payment updates for merchant ${mId}`);
                
                if (!payments || payments.length === 0) {
                    console.log('No payments in merchant data, skipping');
                    continue;
                }
                
                for (const payment of payments) {
                    console.log(`Processing payment ${payment.id} with result: ${payment.result}`);
                    
                    // Find transaction by external ID or Clover payment ID
                    const transactionResult = await client.query(`
                        SELECT id, external_id FROM transactions 
                        WHERE clover_payment_id = $1 OR external_id = $2
                    `, [payment.id, payment.externalPaymentId]);
                    
                    if (transactionResult.rows.length === 0) {
                        console.log(`Transaction not found for payment: ${payment.id}`);
                        continue;
                    }
                    
                    const transaction = transactionResult.rows[0];
                    console.log(`Found transaction ${transaction.id} for payment ${payment.id}`);
                    
                    // Update transaction status based on payment result
                    const status = payment.result === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
                    
                    await client.query(`
                        UPDATE transactions 
                        SET status = $1, completed_at = NOW()
                        WHERE id = $2
                    `, [status, transaction.id]);
                    
                    console.log(`Updated transaction ${transaction.id} status to ${status}`);
                    
                    // If payment succeeded, update inventory (reduce stock)
                    if (payment.result === 'SUCCESS') {
                        const itemsResult = await client.query(`
                            SELECT sku_id, quantity FROM transaction_items 
                            WHERE transaction_id = $1
                        `, [transaction.id]);
                        
                        for (const item of itemsResult.rows) {
                            await client.query(`
                                UPDATE inventory 
                                SET on_hand = GREATEST(0, on_hand - $1),
                                    reserved = GREATEST(0, reserved - $1),
                                    last_updated = NOW(),
                                    sync_source = 'webhook'
                                WHERE sku_id = $2
                            `, [item.quantity, item.sku_id]);
                            
                            console.log(`Reduced inventory for SKU ${item.sku_id} by ${item.quantity}`);
                        }
                    }
                }
            }
            
            await client.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'Payment webhook processed successfully',
                processed_merchants: merchants.length,
                processed_payments: merchants.reduce((total, m) => total + (m.payments?.length || 0), 0)
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Payment webhook error:', error);
        res.status(500).json({ 
            error: 'Failed to process payment webhook',
            message: error.message 
        });
    }
});

// POST /webhooks/orders - Handle order updates from Clover
router.post('/orders', async (req, res) => {
    try {
        console.log('Received order webhook:', JSON.stringify(req.body, null, 2));
        
        // Log the webhook for audit purposes
        const client = await db.connect();
        
        try {
            await client.query(`
                INSERT INTO audit_logs (
                    action, entity_type, new_values
                ) VALUES (
                    'ORDER_WEBHOOK_RECEIVED',
                    'ORDER',
                    $1
                )
            `, [JSON.stringify(req.body)]);
        } catch (auditError) {
            console.error('Failed to log order webhook audit:', auditError.message);
        } finally {
            client.release();
        }
        
        res.json({ 
            success: true, 
            message: 'Order webhook received and logged' 
        });
        
    } catch (error) {
        console.error('Order webhook error:', error);
        res.status(500).json({ 
            error: 'Failed to process order webhook',
            message: error.message 
        });
    }
});

module.exports = router;
