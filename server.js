// ==================================================
// FILE: server.js (Main Server)
// ==================================================
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const cloverService = require('./services/cloverService');
const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// RAW body for webhooks (must come BEFORE express.json)
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

// JSON for everything else
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'Supplement POS API Running',
        version: '1.0.0',
        environment: process.env.NODE_ENV
    });
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/webhooks', webhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});


// --- Health + Diagnostics under /api ---
const dns = require('dns').promises;
const db = require('./config/database');

// Simple ping
app.get('/api/health/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// DNS check
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

// DB check
app.get('/api/health/db', async (req, res) => {
  try {
    const r = await db.query('SELECT 1 AS ok');
    res.json({ db: 'ok', result: r.rows[0] });
  } catch (e) {
    res.status(500).json({ db: 'fail', error: e.message });
  }
});

// ==================================================
// Start server (leave this last)
// ==================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Environment: ${process.env.NODE_ENV}`);
  console.log(`🏪 Clover Merchant: ${process.env.CLOVER_MERCHANT_ID}`);
});



