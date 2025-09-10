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
app.use(express.json());

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
app.use('/webhooks', webhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});


// ==================================================
// Health + Diagnostics (place BEFORE app.listen)
// ==================================================
const dns = require('dns').promises;

// Simple ping (confirms new deploy picked up)
app.get('/health/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// DNS check: can the server resolve your DB host?
app.get('/health/dns', async (req, res) => {
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

// DB check: can we run SELECT 1?
const db = require('./config/database');
app.get('/health/db', async (req, res) => {
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



