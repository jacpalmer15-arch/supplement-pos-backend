// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { authenticateToken, requireMerchant, requireRole } = require('./src/middleware/auth');

const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhooks');
const syncRoutes = require('./routes/sync');
const dns = require('dns').promises;
const db = require('./config/database');

const app = express();

app.use((req, res, next) => {
  console.log('REQ', req.method, req.originalUrl);
  next();
});

const PORT = process.env.PORT || 3000;

// --- Middleware (order matters) ---
app.use(cors());

// RAW body for webhooks (must be BEFORE express.json)
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

// JSON for everything else
app.use(express.json({ limit: '1mb' }));

// Optional landing route
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Supplement POS API', env: process.env.NODE_ENV || 'development' });
});

// --- API Routes ---
// Protected routes (authentication required)
app.use('/api/products', authenticateToken, requireMerchant, productRoutes);
app.use('/api/inventory', authenticateToken, requireMerchant, inventoryRoutes);
app.use('/api/checkout', authenticateToken, requireMerchant, checkoutRoutes);
app.use('/api/sync', syncRoutes); // sync routes handle their own auth

// Public routes (no authentication required)
app.use('/api/webhooks', webhookRoutes); // Clover should call /api/webhooks/*

// Demo protected route to test authentication
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
    merchant: req.merchant,
    message: 'Authentication successful'
  });
});

// Demo admin-only route
app.get('/api/auth/admin', authenticateToken, requireMerchant, requireRole(['admin', 'owner']), (req, res) => {
  res.json({
    success: true,
    message: 'Admin access granted',
    user: req.user,
    merchant: req.merchant
  });
});

// --- Health (for Postman diagnostics) ---
app.get('/api/health/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/health/dns', async (req, res) => {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(500).json({ error: 'DATABASE_URL is not set' });
    const host = new URL(url).hostname.trim();
    const addrs = await dns.resolve(host);
    res.json({ host, addrs });
  } catch (e) {
    res.status(500).json({ error: e.message, database_url_present: !!process.env.DATABASE_URL });
  }
});

app.get('/api/health/db', async (req, res) => {
  try {
    const r = await db.query('SELECT 1 AS ok');
    res.json({ db: 'ok', result: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'fail', error: e.message });
  }
});

// Catch-all 404 AFTER routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

// Error handler LAST
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Only listen locally; on Vercel we export the app
if (process.env.VERCEL !== '1' && require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;

// OAuth callback route
app.get("/clover/callback", (req, res) => {
  const authCode = req.query.code;
  const merchantId = req.query.merchant_id;

  if (!authCode) {
    return res.status(400).send("No auth code received");
  }

  // For now just display the code and merchantId in the browser
  res.send(`Auth Code: ${authCode}<br>Merchant ID: ${merchantId}`);
});

