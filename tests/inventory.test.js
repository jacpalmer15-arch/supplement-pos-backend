// tests/inventory.test.js
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../config/database');

describe('Inventory API', () => {
  let authToken;
  let testMerchantId;
  let testCategoryId;
  let testProductId;
  let otherMerchantToken;
  let otherMerchantId;

  beforeAll(async () => {
    // Set up test merchants and get auth tokens
    const client = await db.connect();
    try {
      // Ensure test merchant exists
      const merchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ('TEST_MERCHANT_INV_123', 'Test Inventory Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `);
      testMerchantId = merchantResult.rows[0].id;

      // Create another merchant for isolation testing
      const otherMerchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ('OTHER_MERCHANT_INV_456', 'Other Inventory Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `);
      otherMerchantId = otherMerchantResult.rows[0].id;

      // Create a test category
      const categoryResult = await client.query(`
        INSERT INTO categories (merchant_id, name, sort_order, active)
        VALUES ($1, 'Test Inventory Category', 1, true)
        RETURNING id
      `, [testMerchantId]);
      testCategoryId = categoryResult.rows[0].id;

      // Create a test product with inventory
      const productResult = await client.query(`
        INSERT INTO products (merchant_id, name, price_cents, sku, category_id, active)
        VALUES ($1, 'Test Inventory Product', 1999, 'TEST-INV-001', $2, true)
        RETURNING id
      `, [testMerchantId, testCategoryId]);
      testProductId = productResult.rows[0].id;

      // Create inventory record for test product
      await client.query(`
        INSERT INTO inventory (product_id, on_hand, reserved, reorder_level, sync_source)
        VALUES ($1, 10, 2, 5, 'test')
      `, [testProductId]);

      // Generate JWT tokens for testing
      authToken = jwt.sign(
        { 
          sub: 'test-user-inv-123',
          merchant_id: testMerchantId,
          exp: Math.floor(Date.now() / 1000) + 3600
        },
        process.env.JWT_SECRET || 'test-secret-key'
      );

      otherMerchantToken = jwt.sign(
        { 
          sub: 'other-user-inv-456',
          merchant_id: otherMerchantId,
          exp: Math.floor(Date.now() / 1000) + 3600
        },
        process.env.JWT_SECRET || 'test-secret-key'
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Clean up test data
    const client = await db.connect();
    try {
      if (testProductId) {
        await client.query('DELETE FROM inventory WHERE product_id = $1', [testProductId]);
        await client.query('DELETE FROM products WHERE id = $1', [testProductId]);
      }
      if (testCategoryId) {
        await client.query('DELETE FROM categories WHERE id = $1', [testCategoryId]);
      }
      if (testMerchantId) {
        await client.query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
      }
      if (otherMerchantId) {
        await client.query('DELETE FROM merchants WHERE id = $1', [otherMerchantId]);
      }
    } finally {
      client.release();
    }
    
    // Close database connections
    await db.end();
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for GET /api/inventory', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .expect(401);

      expect(response.body.error).toContain('Access token required');
    });

    it('should require authentication for PATCH /api/inventory/:productId', async () => {
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .send({ on_hand: 15 })
        .expect(401);

      expect(response.body.error).toContain('Access token required');
    });

    it('should require merchant context', async () => {
      // Create token without merchant info
      const tokenWithoutMerchant = jwt.sign(
        { 
          sub: 'user-without-merchant',
          exp: Math.floor(Date.now() / 1000) + 3600
        },
        process.env.JWT_SECRET || 'test-secret-key'
      );

      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${tokenWithoutMerchant}`)
        .expect(403);

      expect(response.body.error).toContain('Merchant context required');
    });
  });

  describe('GET /api/inventory', () => {
    it('should return inventory items for authenticated merchant', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
      
      // Check that our test product is included
      const testProduct = response.body.data.find(item => item.product_id === testProductId);
      expect(testProduct).toBeDefined();
      expect(testProduct.product_name).toBe('Test Inventory Product');
      expect(testProduct.on_hand).toBe(10);
      expect(testProduct.reorder_level).toBe(5);
      expect(testProduct.status).toBe('IN_STOCK');
    });

    it('should filter by lowStockOnly when specified', async () => {
      // First, create a low stock product
      const client = await db.connect();
      let lowStockProductId;
      try {
        const productResult = await client.query(`
          INSERT INTO products (merchant_id, name, price_cents, sku, active)
          VALUES ($1, 'Low Stock Product', 999, 'LOW-STOCK-001', true)
          RETURNING id
        `, [testMerchantId]);
        lowStockProductId = productResult.rows[0].id;

        await client.query(`
          INSERT INTO inventory (product_id, on_hand, reserved, reorder_level, sync_source)
          VALUES ($1, 2, 0, 5, 'test')
        `, [lowStockProductId]);
      } finally {
        client.release();
      }

      const response = await request(app)
        .get('/api/inventory?lowStockOnly=true')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // All returned items should have low stock status
      response.body.data.forEach(item => {
        expect(['LOW_STOCK', 'OUT_OF_STOCK']).toContain(item.status);
      });

      // Clean up
      const cleanupClient = await db.connect();
      try {
        if (lowStockProductId) {
          await cleanupClient.query('DELETE FROM inventory WHERE product_id = $1', [lowStockProductId]);
          await cleanupClient.query('DELETE FROM products WHERE id = $1', [lowStockProductId]);
        }
      } finally {
        cleanupClient.release();
      }
    });

    it('should enforce merchant isolation', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Should not see products from other merchants
      const hasTestProduct = response.body.data.some(item => item.product_id === testProductId);
      expect(hasTestProduct).toBe(false);
    });
  });

  describe('PATCH /api/inventory/:productId', () => {
    it('should update on_hand quantity', async () => {
      const newOnHand = 25;
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: newOnHand })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.product_id).toBe(testProductId);
      expect(response.body.data.on_hand).toBe(newOnHand);
      expect(response.body.data.status).toBe('IN_STOCK');
    });

    it('should update reorder_level', async () => {
      const newReorderLevel = 8;
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reorder_level: newReorderLevel })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reorder_level).toBe(newReorderLevel);
    });

    it('should update both on_hand and reorder_level', async () => {
      const newOnHand = 12;
      const newReorderLevel = 6;
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: newOnHand, reorder_level: newReorderLevel })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.on_hand).toBe(newOnHand);
      expect(response.body.data.reorder_level).toBe(newReorderLevel);
    });

    it('should validate product ID format', async () => {
      const response = await request(app)
        .patch('/api/inventory/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: 10 })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid product ID format');
    });

    it('should validate on_hand is non-negative integer', async () => {
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: -5 })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('on_hand must be a non-negative integer');
    });

    it('should validate reorder_level is non-negative integer', async () => {
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reorder_level: -1 })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('reorder_level must be a non-negative integer');
    });

    it('should require at least one field to update', async () => {
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Either on_hand or reorder_level must be provided');
    });

    it('should return 404 for non-existent product', async () => {
      const fakeProductId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .patch(`/api/inventory/${fakeProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: 10 })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });

    it('should enforce merchant isolation for updates', async () => {
      const response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .send({ on_hand: 100 })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });

    it('should correctly calculate stock status', async () => {
      // Test OUT_OF_STOCK
      let response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: 0 })
        .expect(200);

      expect(response.body.data.status).toBe('OUT_OF_STOCK');

      // Test LOW_STOCK
      response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: 3, reorder_level: 5 })
        .expect(200);

      expect(response.body.data.status).toBe('LOW_STOCK');

      // Test IN_STOCK
      response = await request(app)
        .patch(`/api/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ on_hand: 20, reorder_level: 5 })
        .expect(200);

      expect(response.body.data.status).toBe('IN_STOCK');
    });
  });

  describe('GET /api/inventory/low-stock', () => {
    beforeAll(async () => {
      // Set up a low stock item for testing
      const client = await db.connect();
      try {
        await client.query(
          'UPDATE inventory SET on_hand = 2, reorder_level = 5 WHERE product_id = $1',
          [testProductId]
        );
      } finally {
        client.release();
      }
    });

    it('should return low stock items', async () => {
      const response = await request(app)
        .get('/api/inventory/low-stock')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // Should include our test product which has low stock
      const testProduct = response.body.data.find(item => item.product_id === testProductId);
      expect(testProduct).toBeDefined();
      expect(testProduct.on_hand).toBeLessThanOrEqual(testProduct.reorder_level);
    });

    it('should enforce merchant isolation', async () => {
      const response = await request(app)
        .get('/api/inventory/low-stock')
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // Should not see low stock items from other merchants
      const hasTestProduct = response.body.data.some(item => item.product_id === testProductId);
      expect(hasTestProduct).toBe(false);
    });
  });
});