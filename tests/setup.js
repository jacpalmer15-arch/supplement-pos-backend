// tests/setup.js
require('dotenv').config();

// Global test setup
beforeAll(async () => {
  // Ensure test environment has necessary env vars
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-key';
  }
});

afterAll(async () => {
  // Give time for connections to close
  await new Promise(resolve => setTimeout(resolve, 500));
});