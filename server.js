// ==================================================
// FILE: server.js (Main Server for Vercel + Local)
// ==================================================
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhooks');

const dns = require('dns').promises;
const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware (order matters) ---
app.use(cors());

// RAW body for webhooks (must be BEFORE express.json)
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

// JSON for everything else
app.use(express.json({ limit: '1mb' }));

// --- Friendly root (optional) ---
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Supplement POS API',
    env: process.env.NODE_ENV || 'development'
  });
});

// --- API Routes (mount under /api/...) ---
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/webhooks', webhookRoutes); // Clover should call /api/webhooks/*

// --- Health & Diagnostics (under /api/health/*) ---
app.get('/api/health/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/health/dns', async (req, res) => {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) return res.status(500).json({ error: 'DATABASE_URL is not set' });
    const host = new URL(url).hostname.trim();
    const addrs = await dns.resolve(host);
    res.json({ host, addrs });
  } catch (e) {
    res.status(500).json({
      error: e.message,
      database_url_present: !!process.env.DATABASE_URL
    });
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

// --- Catch-all 404 (keep AFTER all routes) ---
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// --- Error handler (keep absolutely LAST) ---
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// --- Start server locally only; export app for Vercel ---
if (process.env.VERCEL !== '1' && require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
