const jwt = require('jsonwebtoken');

const secret = 'supplement-shop-secret-key-2024'; // Your backend JWT_SECRET

// Generate current timestamp and 14-day expiration
const now = Math.floor(Date.now() / 1000);
const expires = now + 14 * 24 * 60 * 60; // 14 days in seconds

const payload = {
  sub: 'user-123',
  email: 'me@example.com',
  merchant_id: 'merchant-abc',
  merchant_name: 'Test Merchant',
  role: 'admin',
  iat: now,
  exp: expires
};

const token = jwt.sign(payload, secret);
console.log('JWT Token:\n', token);