// tests/syncService.unit.test.js
const syncService = require('../services/syncService');

// Mock database
jest.mock('../config/database', () => ({
  connect: jest.fn(() => Promise.resolve({
    query: jest.fn(),
    release: jest.fn()
  })),
}));

// Mock clover service
jest.mock('../services/cloverService', () => ({
  fetchPaged: jest.fn()
}));

describe('SyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    process.env.ENABLE_CLOVER = 'true';
    syncService.isCloverEnabled = true;
  });

  describe('isEnabled', () => {
    it('should return true when ENABLE_CLOVER is true', () => {
      process.env.ENABLE_CLOVER = 'true';
      syncService.isCloverEnabled = true;
      expect(syncService.isEnabled()).toBe(true);
    });

    it('should return false when ENABLE_CLOVER is false', () => {
      process.env.ENABLE_CLOVER = 'false';
      syncService.isCloverEnabled = false;
      expect(syncService.isEnabled()).toBe(false);
    });
  });

  describe('createCloverClient', () => {
    it('should create axios client with correct configuration', () => {
      const accessToken = 'test-token-123';
      const client = syncService.createCloverClient(accessToken);
      
      expect(client.defaults.headers.Authorization).toBe('Bearer test-token-123');
      expect(client.defaults.timeout).toBe(30000);
      expect(client.defaults.headers['Content-Type']).toBe('application/json');
    });

    it('should use sandbox URL when CLOVER_ENVIRONMENT is sandbox', () => {
      process.env.CLOVER_ENVIRONMENT = 'sandbox';
      delete process.env.CLOVER_BASE_URL; // Ensure it's not set
      
      const client = syncService.createCloverClient('test-token');
      expect(client.defaults.baseURL).toBe('https://sandbox.dev.clover.com');
    });

    it('should use production URL when CLOVER_ENVIRONMENT is production', () => {
      process.env.CLOVER_ENVIRONMENT = 'production';
      delete process.env.CLOVER_BASE_URL; // Ensure it's not set
      
      const client = syncService.createCloverClient('test-token');
      expect(client.defaults.baseURL).toBe('https://api.clover.com');
    });

    it('should prefer explicit CLOVER_BASE_URL', () => {
      process.env.CLOVER_BASE_URL = 'https://custom.clover.com';
      
      const client = syncService.createCloverClient('test-token');
      expect(client.defaults.baseURL).toBe('https://custom.clover.com');
    });
  });

  describe('performFullSync', () => {
    it('should return disabled response when feature flag is off', async () => {
      syncService.isCloverEnabled = false;
      
      const result = await syncService.performFullSync('merchant-123');
      
      expect(result).toMatchObject({
        success: true,
        message: 'Clover sync is disabled',
        enabled: false,
        categories: { processed: 0 },
        products: { processed: 0 },
        inventory: { processed: 0 }
      });
    });

    it('should return error response when token is missing', async () => {
      const db = require('../config/database');
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] }), // No token found
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      const result = await syncService.performFullSync('merchant-123');
      
      expect(result).toMatchObject({
        success: false,
        enabled: true,
        categories: { processed: 0, errors: expect.any(Array) }
      });
      expect(result.error).toContain('No Clover token found');
    });

    it('should return error response when token is expired', async () => {
      const db = require('../config/database');
      const expiredDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            access_token: 'expired-token',
            expires_at: expiredDate
          }]
        }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      const result = await syncService.performFullSync('merchant-123');
      
      expect(result).toMatchObject({
        success: false,
        enabled: true,
        categories: { processed: 0, errors: expect.any(Array) }
      });
      expect(result.error).toContain('expired');
    });

    it('should handle missing merchant gracefully', async () => {
      const db = require('../config/database');
      // Mock successful token retrieval
      const mockClient1 = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            access_token: 'valid-token',
            expires_at: null
          }]
        }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient1);
      
      // Mock missing merchant
      const mockClient2 = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] }), // No merchant found
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient2);

      const result = await syncService.performFullSync('nonexistent-merchant');
      
      expect(result).toMatchObject({
        success: false,
        enabled: true,
        categories: { processed: 0, errors: expect.any(Array) }
      });
      expect(result.error).toContain('Merchant not found');
    });
  });

  describe('getMerchantCloverToken', () => {
    it('should retrieve valid token successfully', async () => {
      const db = require('../config/database');
      const mockToken = {
        access_token: 'valid-token-123',
        refresh_token: 'refresh-token-123',
        expires_at: null
      };
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockToken] }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      const result = await syncService.getMerchantCloverToken('merchant-123');
      
      expect(result).toEqual(mockToken);
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT access_token, refresh_token, expires_at FROM clover_tokens WHERE merchant_id = $1',
        ['merchant-123']
      );
    });

    it('should throw error when no token exists', async () => {
      const db = require('../config/database');
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      await expect(syncService.getMerchantCloverToken('merchant-123'))
        .rejects.toThrow('No Clover token found for merchant');
    });

    it('should throw error when token is expired', async () => {
      const db = require('../config/database');
      const expiredDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ 
          rows: [{ 
            access_token: 'expired-token',
            expires_at: expiredDate 
          }] 
        }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      await expect(syncService.getMerchantCloverToken('merchant-123'))
        .rejects.toThrow('Clover access token has expired');
    });

    it('should accept token without expiry date', async () => {
      const db = require('../config/database');
      const mockToken = {
        access_token: 'valid-token-123',
        refresh_token: null,
        expires_at: null
      };
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockToken] }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      const result = await syncService.getMerchantCloverToken('merchant-123');
      
      expect(result).toEqual(mockToken);
    });

    it('should accept token with future expiry date', async () => {
      const db = require('../config/database');
      const futureDate = new Date(Date.now() + 3600 * 1000); // 1 hour from now
      const mockToken = {
        access_token: 'valid-token-123',
        refresh_token: 'refresh-token-123',
        expires_at: futureDate
      };
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockToken] }),
        release: jest.fn()
      };
      db.connect.mockResolvedValueOnce(mockClient);

      const result = await syncService.getMerchantCloverToken('merchant-123');
      
      expect(result).toEqual(mockToken);
    });
  });
});