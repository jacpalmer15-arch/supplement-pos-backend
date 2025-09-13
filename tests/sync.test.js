// tests/sync.test.js
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

describe('Sync API', () => {
  let authToken;
  let testMerchantId;
  let testCloverMerchantId = 'TEST_CLOVER_MERCHANT_123';

  beforeAll(async () => {
    // Set up test merchant and token
    const client = await db.connect();
    try {
      // Create test merchant
      const merchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ($1, 'Test Sync Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `, [testCloverMerchantId]);
      testMerchantId = merchantResult.rows[0].id;

      // Create test Clover token
      await client.query(`
        INSERT INTO clover_tokens (merchant_id, access_token, token_type)
        VALUES ($1, 'test_access_token_123', 'bearer')
        ON CONFLICT (merchant_id) DO UPDATE 
        SET access_token = EXCLUDED.access_token
      `, [testMerchantId]);

      // Generate JWT token for testing
      authToken = jwt.sign(
        { 
          sub: 'test-sync-user-123',
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
      await client.query('DELETE FROM clover_tokens WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM inventory WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM categories WHERE merchant_id = $1', [testMerchantId]);
      await client.query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    } finally {
      client.release();
    }
  });

  beforeEach(() => {
    // Reset mocks
    fetchPaged.mockClear();
  });

  describe('GET /api/sync/status', () => {
    it('should return sync status for authenticated merchant', async () => {
      const response = await request(app)
        .get('/api/sync/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        enabled: expect.any(Boolean),
        merchant_id: testMerchantId,
        token_status: 'valid'
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/sync/status');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/sync/full', () => {
    describe('when Clover is enabled', () => {
      beforeEach(() => {
        // Mock Clover as enabled
        process.env.ENABLE_CLOVER = 'true';
        syncService.isCloverEnabled = true;
      });

      it('should perform full sync successfully', async () => {
        // Mock successful Clover API responses
        fetchPaged
          .mockImplementationOnce(async (path, options, callback) => {
            // Categories
            await callback([
              {
                id: 'clover-cat-1',
                name: 'Test Category',
                sortOrder: 1,
                createdTime: Date.now(),
                modifiedTime: Date.now(),
                deleted: false
              }
            ]);
          })
          .mockImplementationOnce(async (path, options, callback) => {
            // Products
            await callback([
              {
                id: 'clover-item-1',
                name: 'Test Product',
                alternateName: 'Test Description',
                price: 1999,
                code: 'TEST-SKU',
                sku: 'TEST-UPC',
                hidden: false,
                deleted: false,
                createdTime: Date.now(),
                modifiedTime: Date.now(),
                categories: {
                  elements: [{ id: 'clover-cat-1' }]
                }
              }
            ]);
          })
          .mockImplementationOnce(async (path, options, callback) => {
            // Inventory
            await callback([
              {
                item: { id: 'clover-item-1' },
                quantity: 50,
                modifiedTime: Date.now()
              }
            ]);
          });

        const response = await request(app)
          .post('/api/sync/full')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          enabled: true,
          categories: { success: true, processed: 1 },
          products: { success: true, processed: 1 },
          inventory: { success: true, processed: 1 }
        });

        // Verify data was inserted
        const client = await db.connect();
        try {
          const categoriesResult = await client.query(
            'SELECT COUNT(*) FROM categories WHERE merchant_id = $1 AND clover_id = $2',
            [testMerchantId, 'clover-cat-1']
          );
          expect(parseInt(categoriesResult.rows[0].count)).toBe(1);

          const productsResult = await client.query(
            'SELECT COUNT(*) FROM products WHERE merchant_id = $1 AND clover_id = $2',
            [testMerchantId, 'clover-item-1']
          );
          expect(parseInt(productsResult.rows[0].count)).toBe(1);

          const inventoryResult = await client.query(
            'SELECT COUNT(*) FROM inventory WHERE merchant_id = $1 AND clover_item_id = $2',
            [testMerchantId, 'clover-item-1']
          );
          expect(parseInt(inventoryResult.rows[0].count)).toBe(1);
        } finally {
          client.release();
        }
      });

      it('should return 400 when no Clover token exists', async () => {
        // Remove token temporarily
        const client = await db.connect();
        try {
          await client.query('DELETE FROM clover_tokens WHERE merchant_id = $1', [testMerchantId]);
        } finally {
          client.release();
        }

        const response = await request(app)
          .post('/api/sync/full')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('No Clover access token found');

        // Restore token
        try {
          await client.query(`
            INSERT INTO clover_tokens (merchant_id, access_token, token_type)
            VALUES ($1, 'test_access_token_123', 'bearer')
          `, [testMerchantId]);
        } finally {
          client.release();
        }
      });

      it('should return 401 when Clover token is expired', async () => {
        // Set expired token
        const client = await db.connect();
        try {
          await client.query(`
            UPDATE clover_tokens 
            SET expires_at = $2
            WHERE merchant_id = $1
          `, [testMerchantId, new Date(Date.now() - 3600 * 1000)]); // 1 hour ago
        } finally {
          client.release();
        }

        const response = await request(app)
          .post('/api/sync/full')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(401);
        expect(response.body.error).toContain('expired');

        // Remove expiry
        try {
          await client.query(`
            UPDATE clover_tokens 
            SET expires_at = NULL
            WHERE merchant_id = $1
          `, [testMerchantId]);
        } finally {
          client.release();
        }
      });

      it('should handle sync errors gracefully', async () => {
        // Mock API error
        fetchPaged.mockImplementationOnce(async () => {
          throw new Error('Clover API error');
        });

        const response = await request(app)
          .post('/api/sync/full')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          success: false,
          enabled: true,
          categories: { processed: 0, errors: expect.any(Array) }
        });
      });
    });

    describe('when Clover is disabled', () => {
      beforeEach(() => {
        // Mock Clover as disabled
        process.env.ENABLE_CLOVER = 'false';
        syncService.isCloverEnabled = false;
      });

      it('should return stubbed response when feature flag is disabled', async () => {
        const response = await request(app)
          .post('/api/sync/full')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          message: 'Clover sync is currently disabled',
          enabled: false,
          categories: { processed: 0 },
          products: { processed: 0 },
          inventory: { processed: 0 }
        });

        // Verify no API calls were made
        expect(fetchPaged).not.toHaveBeenCalled();
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/sync/full');

      expect(response.status).toBe(401);
    });

    it('should return 400 with invalid merchant context', async () => {
      // Create token without merchant_id
      const invalidToken = jwt.sign(
        { 
          sub: 'test-user-no-merchant',
          exp: Math.floor(Date.now() / 1000) + 3600
        },
        process.env.JWT_SECRET
      );

      const response = await request(app)
        .post('/api/sync/full')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Merchant context required');
    });
  });

  describe('Upsert Logic', () => {
    beforeEach(() => {
      process.env.ENABLE_CLOVER = 'true';
      syncService.isCloverEnabled = true;
    });

    it('should update existing records on second sync', async () => {
      // First sync
      fetchPaged.mockImplementationOnce(async (path, options, callback) => {
        await callback([
          {
            id: 'clover-cat-update',
            name: 'Original Category Name',
            sortOrder: 1,
            createdTime: Date.now(),
            modifiedTime: Date.now(),
            deleted: false
          }
        ]);
      });

      await request(app)
        .post('/api/sync/full')
        .set('Authorization', `Bearer ${authToken}`);

      // Second sync with updated data
      fetchPaged.mockImplementationOnce(async (path, options, callback) => {
        await callback([
          {
            id: 'clover-cat-update',
            name: 'Updated Category Name',
            sortOrder: 2,
            createdTime: Date.now(),
            modifiedTime: Date.now(),
            deleted: false
          }
        ]);
      });

      await request(app)
        .post('/api/sync/full')
        .set('Authorization', `Bearer ${authToken}`);

      // Verify update
      const client = await db.connect();
      try {
        const result = await client.query(
          'SELECT name, sort_order FROM categories WHERE merchant_id = $1 AND clover_id = $2',
          [testMerchantId, 'clover-cat-update']
        );
        expect(result.rows[0]).toMatchObject({
          name: 'Updated Category Name',
          sort_order: 2
        });
      } finally {
        client.release();
      }
    });
  });
});