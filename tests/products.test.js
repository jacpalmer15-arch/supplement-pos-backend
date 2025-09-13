// tests/products.test.js
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../config/database');

describe('Products API', () => {
  let authToken;
  let testMerchantId;
  let testCategoryId;
  let testProductId;

  beforeAll(async () => {
    // Set up test merchant and get auth token
    const client = await db.connect();
    try {
      // Ensure test merchant exists
      const merchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ('TEST_MERCHANT_123', 'Test Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `);
      testMerchantId = merchantResult.rows[0].id;

      // Create a test category
      const categoryResult = await client.query(`
        INSERT INTO categories (merchant_id, name, sort_order, active)
        VALUES ($1, 'Test Category', 1, true)
        RETURNING id
      `, [testMerchantId]);
      testCategoryId = categoryResult.rows[0].id;

      // Generate JWT token for testing
      authToken = jwt.sign(
        { 
          sub: 'test-user-123',
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
    } finally {
      client.release();
    }
    
    // Close database connections
    await db.end();
  });

  describe('Authentication', () => {
    it('should reject requests without authorization header', async () => {
      const response = await request(app)
        .get('/api/products')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authorization header');
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/products')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid token');
    });

    it('should accept requests with valid token', async () => {
      const response = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/products', () => {
    it('should return empty list when no products exist', async () => {
      const response = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should filter by search parameter', async () => {
      const response = await request(app)
        .get('/api/products?search=protein')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by categoryId parameter', async () => {
      const response = await request(app)
        .get(`/api/products?categoryId=${testCategoryId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by visibleInKiosk parameter', async () => {
      const response = await request(app)
        .get('/api/products?visibleInKiosk=true')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('POST /api/products', () => {
    it('should create a new product with valid data', async () => {
      const productData = {
        name: 'Test Protein Powder',
        description: 'High quality whey protein',
        price_cents: 2999,
        sku: 'TEST-PROTEIN-001',
        upc: '123456789012',
        category_id: testCategoryId,
        visible_in_kiosk: true,
        brand: 'Test Brand'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send(productData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(productData.name);
      expect(response.body.data.price_cents).toBe(productData.price_cents);
      expect(response.body.data.sku).toBe(productData.sku);

      testProductId = response.body.data.id; // Save for cleanup
    });

    it('should reject product creation without required fields', async () => {
      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Missing name and price' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should reject product creation with invalid price_cents', async () => {
      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Product',
          price_cents: -100 // Invalid negative price
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('price_cents must be a non-negative integer');
    });
  });

  describe('GET /api/products/:id', () => {
    it('should return a specific product by ID', async () => {
      if (!testProductId) {
        // Create a product first if not already created
        const productData = {
          name: 'Test Product for Get',
          price_cents: 1999
        };

        const createResponse = await request(app)
          .post('/api/products')
          .set('Authorization', `Bearer ${authToken}`)
          .send(productData);

        testProductId = createResponse.body.data.id;
      }

      const response = await request(app)
        .get(`/api/products/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.product_id).toBe(testProductId);
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/products/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });

    it('should return 400 for invalid product ID format', async () => {
      const response = await request(app)
        .get('/api/products/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid product ID format');
    });
  });

  describe('PATCH /api/products/:id', () => {
    it('should update a product with valid data', async () => {
      if (!testProductId) {
        // Create a product first if not already created
        const productData = {
          name: 'Test Product for Update',
          price_cents: 1999
        };

        const createResponse = await request(app)
          .post('/api/products')
          .set('Authorization', `Bearer ${authToken}`)
          .send(productData);

        testProductId = createResponse.body.data.id;
      }

      const updateData = {
        name: 'Updated Product Name',
        price_cents: 2499
      };

      const response = await request(app)
        .patch(`/api/products/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(updateData.name);
      expect(response.body.data.price_cents).toBe(updateData.price_cents);
    });

    it('should return 404 for updating non-existent product', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .patch(`/api/products/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('should delete a product successfully', async () => {
      // Create a product to delete
      const productData = {
        name: 'Product to Delete',
        price_cents: 999
      };

      const createResponse = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send(productData);

      const productToDelete = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/products/${productToDelete}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Product deleted successfully');

      // Verify product is actually deleted
      await request(app)
        .get(`/api/products/${productToDelete}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 404 for deleting non-existent product', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .delete(`/api/products/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Product not found');
    });
  });

  describe('Merchant Isolation', () => {
    let otherMerchantToken;
    let otherMerchantId;

    beforeAll(async () => {
      // Create another merchant for isolation testing
      const client = await db.connect();
      try {
        const merchantResult = await client.query(`
          INSERT INTO merchants (clover_merchant_id, business_name, active)
          VALUES ('OTHER_MERCHANT_456', 'Other Merchant', true)
          RETURNING id
        `);
        otherMerchantId = merchantResult.rows[0].id;

        otherMerchantToken = jwt.sign(
          { 
            sub: 'other-user-456',
            merchant_id: otherMerchantId,
            exp: Math.floor(Date.now() / 1000) + 3600
          },
          process.env.JWT_SECRET
        );
      } finally {
        client.release();
      }
    });

    afterAll(async () => {
      // Clean up other merchant
      const client = await db.connect();
      try {
        await client.query('DELETE FROM merchants WHERE id = $1', [otherMerchantId]);
      } finally {
        client.release();
      }
    });

    it('should not see products from other merchants', async () => {
      // Get products as other merchant - should not see our test products
      const response = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('should not be able to access other merchant\'s products', async () => {
      if (testProductId) {
        const response = await request(app)
          .get(`/api/products/${testProductId}`)
          .set('Authorization', `Bearer ${otherMerchantToken}`)
          .expect(404);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Product not found');
      }
    });
  });
});