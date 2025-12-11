// tests/orders-sync.test.js
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../config/database');
const syncService = require('../services/syncService');

// Mock the clover service
jest.mock('../services/cloverService', () => ({
  fetchPaged: jest.fn()
}));

const { fetchPaged } = require('../services/cloverService');

describe('Orders Sync API', () => {
  let authToken;
  let testMerchantId;
  let testCloverMerchantId = 'TEST_CLOVER_MERCHANT_ORDERS';

  beforeAll(async () => {
    // Set up test merchant and token
    const client = await db.connect();
    try {
      // Create test merchant
      const merchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ($1, 'Test Orders Sync Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `, [testCloverMerchantId]);
      testMerchantId = merchantResult.rows[0].id;

      // Create test Clover token
      await client.query(`
        INSERT INTO clover_tokens (merchant_id, access_token, token_type)
        VALUES ($1, 'test_access_token_orders', 'bearer')
        ON CONFLICT (merchant_id) DO UPDATE 
        SET access_token = EXCLUDED.access_token
      `, [testMerchantId]);

      // Generate JWT token for testing
      authToken = jwt.sign(
        { 
          sub: 'test-orders-sync-user',
          merchant_id: testMerchantId,
          exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        },
        process.env.JWT_SECRET
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Clean up test data
    const client = await db.connect();
    try {
      await client.query('DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE merchant_id = $1)', [testMerchantId]);
      await client.query('DELETE FROM transactions WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM clover_tokens WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    } finally {
      client.release();
    }
  });

  beforeEach(() => {
    // Reset mocks
    fetchPaged.mockClear();
  });

  describe('POST /api/sync/orders', () => {
    describe('when Clover is enabled', () => {
      beforeEach(() => {
        // Mock Clover as enabled
        process.env.ENABLE_CLOVER = 'true';
        syncService.isCloverEnabled = true;
      });

      it('should sync orders successfully', async () => {
        const now = Date.now();
        
        // Mock Clover orders API response
        fetchPaged.mockImplementationOnce(async (path, options, callback) => {
          await callback([
            {
              id: 'ORDER_001',
              externalId: 'ext-001',
              state: 'OPEN',
              paymentState: null,
              total: 2000,
              createdTime: now,
              modifiedTime: now,
              lineItems: {
                elements: [
                  {
                    id: 'LINE_001',
                    name: 'Test Product',
                    price: 2000,
                    quantity: 1,
                    item: { id: 'ITEM_001' }
                  }
                ]
              }
            }
          ]);
        });

        const response = await request(app)
          .post('/api/sync/orders')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          enabled: true,
          processed: 1,
          inserted: 1,
          updated: 0,
          marked_for_delete: 0,
          unmatched: 0
        });

        // Verify transaction was created
        const client = await db.connect();
        try {
          const transactionResult = await client.query(
            'SELECT * FROM transactions WHERE merchant_id = $1 AND clover_order_id = $2',
            [testMerchantId, 'ORDER_001']
          );
          expect(transactionResult.rows.length).toBe(1);
          expect(transactionResult.rows[0]).toMatchObject({
            clover_order_id: 'ORDER_001',
            external_id: 'ext-001',
            status: 'OPEN',
            total_cents: 2000,
            order_from_sc: false
          });

          // Verify transaction_items were created
          const itemsResult = await client.query(
            'SELECT * FROM transaction_items WHERE transaction_id = $1',
            [transactionResult.rows[0].id]
          );
          expect(itemsResult.rows.length).toBe(1);
          expect(itemsResult.rows[0]).toMatchObject({
            clover_item_id: 'ITEM_001',
            product_name: 'Test Product',
            quantity: 1,
            unit_price_cents: 2000
          });
        } finally {
          client.release();
        }
      });

      it('should update existing orders on second sync', async () => {
        const now = Date.now();
        
        // First sync
        fetchPaged.mockImplementationOnce(async (path, options, callback) => {
          await callback([
            {
              id: 'ORDER_002',
              state: 'OPEN',
              paymentState: null,
              total: 1500,
              createdTime: now,
              modifiedTime: now,
              lineItems: { elements: [] }
            }
          ]);
        });

        await request(app)
          .post('/api/sync/orders')
          .set('Authorization', `Bearer ${authToken}`);

        // Second sync with updated data
        fetchPaged.mockImplementationOnce(async (path, options, callback) => {
          await callback([
            {
              id: 'ORDER_002',
              state: 'PAID',
              paymentState: 'PAID',
              total: 1500,
              createdTime: now,
              modifiedTime: now + 1000,
              lineItems: { elements: [] }
            }
          ]);
        });

        const response = await request(app)
          .post('/api/sync/orders')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.body).toMatchObject({
          processed: 1,
          inserted: 0,
          updated: 1
        });

        // Verify transaction was updated
        const client = await db.connect();
        try {
          const result = await client.query(
            'SELECT status, completed_at FROM transactions WHERE merchant_id = $1 AND clover_order_id = $2',
            [testMerchantId, 'ORDER_002']
          );
          expect(result.rows[0].status).toBe('PAID');
          expect(result.rows[0].completed_at).not.toBeNull();
        } finally {
          client.release();
        }
      });

      it('should handle prune=true to mark unmatched transactions', async () => {
        const client = await db.connect();
        const now = Date.now();
        
        try {
          // Create a transaction that won't be in the Clover response
          await client.query(`
            INSERT INTO transactions (
              merchant_id, clover_order_id, external_id, 
              subtotal_cents, tax_cents, discount_cents, total_cents,
              status, order_from_sc
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [testMerchantId, 'ORDER_TO_DELETE', 'ext-to-delete', 1000, 0, 0, 1000, 'OPEN', false]);
        } finally {
          client.release();
        }

        // Mock Clover returning different orders
        fetchPaged.mockImplementationOnce(async (path, options, callback) => {
          await callback([
            {
              id: 'ORDER_003',
              state: 'OPEN',
              total: 2500,
              createdTime: now,
              lineItems: { elements: [] }
            }
          ]);
        });

        const response = await request(app)
          .post('/api/sync/orders?prune=true')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.body).toMatchObject({
          success: true,
          processed: 1,
          marked_for_delete: 1
        });

        // Verify unmatched transaction was marked
        try {
          const result = await client.query(
            'SELECT status FROM transactions WHERE merchant_id = $1 AND clover_order_id = $2',
            [testMerchantId, 'ORDER_TO_DELETE']
          );
          expect(result.rows[0].status).toBe('delete');
        } finally {
          client.release();
        }
      });

      it('should not mark transactions when prune=false', async () => {
        const client = await db.connect();
        const now = Date.now();
        
        try {
          // Create a transaction that won't be in the Clover response
          await client.query(`
            INSERT INTO transactions (
              merchant_id, clover_order_id, external_id, 
              subtotal_cents, tax_cents, discount_cents, total_cents,
              status, order_from_sc
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT DO NOTHING
          `, [testMerchantId, 'ORDER_NO_DELETE', 'ext-no-delete', 1000, 0, 0, 1000, 'OPEN', false]);
        } finally {
          client.release();
        }

        // Mock Clover returning different orders
        fetchPaged.mockImplementationOnce(async (path, options, callback) => {
          await callback([
            {
              id: 'ORDER_004',
              state: 'OPEN',
              total: 3000,
              createdTime: now,
              lineItems: { elements: [] }
            }
          ]);
        });

        const response = await request(app)
          .post('/api/sync/orders?prune=false')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.body).toMatchObject({
          success: true,
          marked_for_delete: 0,
          unmatched: expect.any(Number)
        });

        // Verify transaction was NOT marked for deletion
        try {
          const result = await client.query(
            'SELECT status FROM transactions WHERE merchant_id = $1 AND clover_order_id = $2',
            [testMerchantId, 'ORDER_NO_DELETE']
          );
          if (result.rows.length > 0) {
            expect(result.rows[0].status).not.toBe('delete');
          }
        } finally {
          client.release();
        }
      });

      it('should handle limit parameter', async () => {
        fetchPaged.mockImplementationOnce(async (path, options) => {
          // Verify limit was passed
          expect(options.limit).toBe(50);
        });

        await request(app)
          .post('/api/sync/orders?limit=50')
          .set('Authorization', `Bearer ${authToken}`);

        expect(fetchPaged).toHaveBeenCalled();
      });

      it('should handle errors gracefully', async () => {
        // Mock API error
        fetchPaged.mockImplementationOnce(async () => {
          throw new Error('Clover API error');
        });

        const response = await request(app)
          .post('/api/sync/orders')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          success: false,
          enabled: true,
          errors: expect.any(Array)
        });
      });
    });

    describe('when Clover is disabled', () => {
      beforeEach(() => {
        // Mock Clover as disabled
        process.env.ENABLE_CLOVER = 'false';
        syncService.isCloverEnabled = false;
      });

      it('should return disabled response when feature flag is off', async () => {
        const response = await request(app)
          .post('/api/sync/orders')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          enabled: false,
          message: 'Clover sync is currently disabled',
          processed: 0
        });

        // Verify no API calls were made
        expect(fetchPaged).not.toHaveBeenCalled();
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/sync/orders');

      expect(response.status).toBe(401);
    });

    it('should return 403 without merchant context', async () => {
      // Create token without merchant_id
      const invalidToken = jwt.sign(
        { 
          sub: 'test-user-no-merchant',
          exp: Math.floor(Date.now() / 1000) + 3600
        },
        process.env.JWT_SECRET
      );

      const response = await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Merchant context required');
    });
  });
});
