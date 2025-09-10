// routes/webhooks.js
const express = require('express');
const db = require('../config/database');
const router = express.Router();

function getPayload(req) {
  return Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
}

// POST /api/webhooks/inventory
router.post('/inventory', async (req, res) => {
  try {
    const payload = getPayload(req);
    const merchants = Array.isArray(payload?.merchants) ? payload.merchants : [];
    if (merchants.length === 0) return res.json({ success: true, message: 'No merchants in payload' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const merchant of merchants) {
        const items = Array.isArray(merchant.items) ? merchant.items : [];
        for (const item of items) {
          const cloverItemId = item.id;
          const qty = Number(item.stockCount ?? item.quantity ?? 0);

          await client.query(
            `
            INSERT INTO inventory (sku_id, on_hand, last_updated, sync_source)
            SELECT s.id, $1, NOW(), 'webhook'
            FROM skus s
            JOIN products p ON p.id = s.product_id
            WHERE p.clover_item_id = $2
            ON CONFLICT (sku_id)
            DO UPDATE SET
              on_hand = EXCLUDED.on_hand,
              last_updated = EXCLUDED.last_updated,
              sync_source = EXCLUDED.sync_source
            `,
            [qty, cloverItemId]
          );
        }
      }
      await client.query('COMMIT');
      res.json({ success: true, message: 'Inventory updated' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Inventory webhook error:', error);
    res.status(500).json({ error: 'Failed to process inventory webhook' });
  }
});

// POST /api/webhooks/payments
router.post('/payments', async (req, res) => {
  try {
    const payload = getPayload(req);
    const merchants = Array.isArray(payload?.merchants) ? payload.merchants : [];
    if (merchants.length === 0) return res.json({ success: true, message: 'No merchants in payload' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const merchant of merchants) {
        const payments = Array.isArray(merchant.payments) ? merchant.payments : [];
        for (const p of payments) {
          const tx = await client.query(
            `SELECT id FROM transactions WHERE clover_payment_id = $1 OR external_id = $2`,
            [p.id || null, p.externalPaymentId || null]
          );
          if (tx.rows.length === 0) continue;

          const status = p.result === 'SUCCESS' ? 'COMPLETED' : 'FAILED';
          await client.query(
            `UPDATE transactions
             SET status = $1,
                 completed_at = CASE WHEN $1='COMPLETED' THEN NOW() ELSE completed_at END
             WHERE id = $2`,
            [status, tx.rows[0].id]
          );
        }
      }
      await client.query('COMMIT');
      res.json({ success: true, message: 'Payment webhook processed' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Failed to process payment webhook' });
  }
});

module.exports = router;
