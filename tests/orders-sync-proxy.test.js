// tests/orders-sync-proxy.test.js
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const app = require('../server');
const db = require('../config/database');
const syncService = require('../services/syncService');

// Mock axios for proxy tests
jest.mock('axios');

// Mock the clover service for local fallback tests
jest.mock('../services/cloverService', () => ({
  fetchPaged: jest.fn()
}));

const { fetchPaged } = require('../services/cloverService');

describe('Orders Sync Proxy API', () => {
  let authToken;
  let testMerchantId;
  let testCloverMerchantId = 'TEST_PROXY_MERCHANT';
  let originalVercelBaseUrl;

  beforeAll(async () => {
    // Save original VERCEL_BASE_URL
    originalVercelBaseUrl = process.env.VERCEL_BASE_URL;

    // Set up test merchant and token
    const client = await db.connect();
    try {
      // Create test merchant
      const merchantResult = await client.query(`
        INSERT INTO merchants (clover_merchant_id, business_name, active)
        VALUES ($1, 'Test Proxy Merchant', true)
        ON CONFLICT (clover_merchant_id) DO UPDATE 
        SET active = true
        RETURNING id
      `, [testCloverMerchantId]);
      testMerchantId = merchantResult.rows[0].id;

      // Create test Clover token
      await client.query(`
        INSERT INTO clover_tokens (merchant_id, access_token, token_type)
        VALUES ($1, 'test_access_token_proxy', 'bearer')
        ON CONFLICT (merchant_id) DO UPDATE 
        SET access_token = EXCLUDED.access_token
      `, [testMerchantId]);

      // Generate JWT token for testing
      authToken = jwt.sign(
        { 
          sub: 'test-proxy-user',
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
    // Restore original VERCEL_BASE_URL
    if (originalVercelBaseUrl !== undefined) {
      process.env.VERCEL_BASE_URL = originalVercelBaseUrl;
    } else {
      delete process.env.VERCEL_BASE_URL;
    }

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
    axios.post.mockClear();
    fetchPaged.mockClear();
  });

  describe('Proxy mode (VERCEL_BASE_URL is set)', () => {
    beforeEach(() => {
      // Set VERCEL_BASE_URL to enable proxy mode
      process.env.VERCEL_BASE_URL = 'https://example-vercel-app.vercel.app';
    });

    afterEach(() => {
      delete process.env.VERCEL_BASE_URL;
    });

    it('should proxy request to Vercel endpoint with query string', async () => {
      const mockResponse = {
        status: 200,
        data: {
          success: true,
          processed: 5,
          inserted: 3,
          updated: 2
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/sync/orders?limit=50&prune=true')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send({ someData: 'test' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResponse.data);

      // Verify axios was called with correct parameters
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        'https://example-vercel-app.vercel.app/api/products/sync?limit=50&prune=true',
        { someData: 'test' },
        expect.objectContaining({
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 120000,
          validateStatus: expect.any(Function)
        })
      );
    });

    it('should proxy request without query string', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };

      axios.post.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(axios.post).toHaveBeenCalledWith(
        'https://example-vercel-app.vercel.app/api/products/sync',
        expect.anything(),
        expect.anything()
      );
    });

    it('should handle trailing slash in VERCEL_BASE_URL', async () => {
      process.env.VERCEL_BASE_URL = 'https://example-vercel-app.vercel.app/';

      const mockResponse = {
        status: 200,
        data: { success: true }
      };

      axios.post.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(axios.post).toHaveBeenCalledWith(
        'https://example-vercel-app.vercel.app/api/products/sync',
        expect.anything(),
        expect.anything()
      );
    });

    it('should forward upstream error responses', async () => {
      const mockError = {
        response: {
          status: 500,
          data: {
            success: false,
            error: 'Upstream sync failed'
          }
        }
      };

      axios.post.mockRejectedValue(mockError);

      const response = await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Upstream sync failed'
      });
    });

    it('should return 502 on network errors', async () => {
      const mockError = new Error('Network error');
      // No response property means network error
      axios.post.mockRejectedValue(mockError);

      const response = await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Bad Gateway: Unable to reach upstream sync endpoint',
        details: 'Network error'
      });
    });

    it('should forward non-200 status codes from upstream', async () => {
      const mockResponse = {
        status: 400,
        data: {
          success: false,
          error: 'Invalid request'
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid request'
      });
    });
  });

  describe('Local mode (VERCEL_BASE_URL not set)', () => {
    beforeEach(() => {
      // Ensure VERCEL_BASE_URL is not set
      delete process.env.VERCEL_BASE_URL;
      // Mock Clover as enabled
      process.env.ENABLE_CLOVER = 'true';
      syncService.isCloverEnabled = true;
    });

    it('should use local sync when VERCEL_BASE_URL is not set', async () => {
      const now = Date.now();

      // Mock Clover orders API response
      fetchPaged.mockImplementationOnce(async (path, options, callback) => {
        await callback([
          {
            id: 'LOCAL_ORDER_001',
            state: 'OPEN',
            total: 1000,
            createdTime: now,
            modifiedTime: now,
            lineItems: { elements: [] }
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
        processed: 1
      });

      // Verify axios was NOT called (not in proxy mode)
      expect(axios.post).not.toHaveBeenCalled();
      
      // Verify local sync was performed
      expect(fetchPaged).toHaveBeenCalled();
    });

    it('should use local sync when VERCEL_BASE_URL is empty string', async () => {
      process.env.VERCEL_BASE_URL = '';

      const now = Date.now();

      fetchPaged.mockImplementationOnce(async (path, options, callback) => {
        await callback([
          {
            id: 'LOCAL_ORDER_002',
            state: 'OPEN',
            total: 1500,
            createdTime: now,
            modifiedTime: now,
            lineItems: { elements: [] }
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
        processed: 1
      });

      expect(axios.post).not.toHaveBeenCalled();
      expect(fetchPaged).toHaveBeenCalled();
    });

    it('should use local sync when VERCEL_BASE_URL is whitespace', async () => {
      process.env.VERCEL_BASE_URL = '   ';

      const now = Date.now();

      fetchPaged.mockImplementationOnce(async (path, options, callback) => {
        await callback([]);
      });

      const response = await request(app)
        .post('/api/sync/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(axios.post).not.toHaveBeenCalled();
      expect(fetchPaged).toHaveBeenCalled();
    });
  });
});
