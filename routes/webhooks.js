// ==================================================
// FILE: routes/webhooks.js
// ==================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const router = express.Router();

// POST /webhooks/inventory - Handle inventory updates from Clover
router.post('/inventory', async (req, res) => {
  try {
    // If express.raw() was used, req.body is a Buffer. Parse it safely.
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;

    console.log('Received inventory webhook:', payload);

    const { appId, merchants } = payload;
    // ...
       
        if (!merchants || merchants.length === 0) {
            return res.status(400).json({ error: 'No merchant data in webhook' });
        }
        
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const merchant of merchants) {
                const { mId, items } = merchant;
                
                if (!items || items.length === 0) continue;
                
                for (const item of items) {
                    // Update inventory for this item
                    await client.query(`
                        UPDATE inventory 
                        SET on_hand = $1, last_updated = NOW(), sync_source = 'webhook'
                        FROM skus s 
                        WHERE inventory.sku_id = s.id 
                        AND s.clover_variant_id = $2
                    `, [
                        item.stockCount || 0,
                        item.id
                    ]);
                    
                    console.log(`Updated inventory for item ${item.id}: ${item.stockCount}`);
                }
            }
            
            await client.query('COMMIT');
            
            // Log the webhook for audit
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
            
            res.json({ success: true, message: 'Inventory updated successfully' });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Inventory webhook error:', error);
        res.status(500).json({ error: 'Failed to process inventory webhook' });
    }
});

// POST /webhooks/payments - Handle payment updates from Clover  
router.post('/payments', async (req, res) => {
  try {
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;

    console.log('Received payment webhook:', payload);

    const { appId, merchants } = payload;
    // ...
        
        if (!merchants || merchants.length === 0) {
            return res.status(400).json({ error: 'No merchant data in webhook' });
        }
        
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const merchant of merchants) {
                const { mId, payments } = merchant;
                
                if (!payments || payments.length === 0) continue;
                
                for (const payment of payments) {
                    // Find transaction by external ID or Clover payment ID
                    const transactionResult = await client.query(`
                        SELECT id FROM transactions 
                        WHERE clover_payment_id = $1 OR external_id = $2
                    `, [payment.id, payment.externalPaymentId]);
                    
                    if (transactionResult.rows.length === 0) {
                        console.log(`Transaction not found for payment: ${payment.id}`);
                        continue;
                    }
                    
                    const transactionId = transactionResult.rows[0].id;
                    
                    // Update transaction status based on payment result
                    const status = payment.result === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
                    
                    await client.query(`
                        UPDATE transactions 
                        SET status = $1, completed_at = NOW()
                        WHERE id = $2
                    `, [status, transactionId]);
                    
                    // If payment succeeded, update inventory
                    if (payment.result === 'SUCCESS') {
                        const itemsResult = await client.query(`
                            SELECT sku_id, quantity FROM transaction_items 
                            WHERE transaction_id = $1
                        `, [transactionId]);
                        
                        for (const item of itemsResult.rows) {
                            await client.query(`
                                UPDATE inventory 
                                SET on_hand = on_hand - $1,
                                    reserved = GREATEST(0, reserved - $1),
                                    last_updated = NOW(),
                                    sync_source = 'webhook'
                                WHERE sku_id = $2
                            `, [item.quantity, item.sku_id]);
                        }
                    }
                    
                    console.log(`Updated transaction ${transactionId} status to ${status}`);
                }
            }
            
            await client.query('COMMIT');
            
            res.json({ success: true, message: 'Payment webhook processed successfully' });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Payment webhook error:', error);
        res.status(500).json({ error: 'Failed to process payment webhook' });
    }
});

// POST /webhooks/orders - Handle order updates from Clover
router.post('/orders', async (req, res) => {
    try {
        console.log('Received order webhook:', req.body);
        
        // Log the webhook for audit purposes
        const client = await db.connect();
        
        await client.query(`
            INSERT INTO audit_logs (
                action, entity_type, new_values
            ) VALUES (
                'ORDER_WEBHOOK_RECEIVED',
                'ORDER',
                $1
            )
        `, [JSON.stringify(req.body)]);
        
        client.release();
        
        res.json({ success: true, message: 'Order webhook received' });
        
    } catch (error) {
        console.error('Order webhook error:', error);
        res.status(500).json({ error: 'Failed to process order webhook' });
    }
});

// Webhook signature verification middleware (for production)
function verifyWebhookSignature(req, res, next) {
    if (process.env.NODE_ENV !== 'production') {
        return next(); // Skip verification in development
    }
    
    const signature = req.headers['x-clover-hmac-sha256'];
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
        .createHmac('sha256', process.env.CLOVER_APP_SECRET)
        .update(body)
        .digest('base64');
    
    if (signature !== expectedSignature) {
        console.error('Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
    }
    
    next();
}

// Apply signature verification to all webhook routes
router.use(verifyWebhookSignature);

module.exports = router;
