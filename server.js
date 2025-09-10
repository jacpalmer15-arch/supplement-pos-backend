// server.js - Main Server Entry Point
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import route handlers
const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhooks');

// Import database for health checks
const db = require('./config/database');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-frontend-domain.com'] // Update with your frontend URL
        : true, // Allow all origins in development
    credentials: true
}));

// Raw body middleware for webhooks ONLY (Clover requires raw body for signature verification)
app.use('/webhooks', express.raw({ 
    type: 'application/json', 
    limit: '1mb' 
}));

// JSON middleware for all other routes
app.use(express.json({ limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Root health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'Supplement POS API Running',
        version: '1.0.0',
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// Health check endpoints
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/health/ping', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/health/dns', async (req, res) => {
    try {
        const url = process.env.DATABASE_URL;
        if (!url) {
            return res.status(500).json({ 
                error: 'DATABASE_URL is not set',
                database_url_present: false 
            });
        }
        
        const host = new URL(url).hostname.trim();
        const addrs = await dns.resolve(host);
        
        res.json({ 
            host, 
            addrs,
            database_url_present: true 
        });
    } catch (e) {
        res.status(500).json({ 
            error: e.message, 
            database_url_present: !!process.env.DATABASE_URL 
        });
    }
});

app.get('/health/db', async (req, res) => {
    try {
        const result = await db.query('SELECT 1 AS ok, NOW() AS timestamp');
        res.json({ 
            db: 'connected', 
            result: result.rows[0] 
        });
    } catch (e) {
        res.status(500).json({ 
            db: 'failed', 
            error: e.message 
        });
    }
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/checkout', checkoutRoutes);

// Webhook Routes (separate from /api because Clover will call these directly)
app.use('/webhooks', webhookRoutes);

// Catch-all for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        method: req.method,
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

// Global error handling middleware (must be last)
app.use((err, req, res, next) => {
    console.error('Global error handler:', err.stack);
    
    res.status(err.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Clover Merchant: ${process.env.CLOVER_MERCHANT_ID || 'not set'}`);
    console.log(`Database URL present: ${!!process.env.DATABASE_URL}`);
    
    // Log available routes
    console.log('\nAvailable endpoints:');
    console.log('GET  / - Health check');
    console.log('GET  /health/* - Various health checks');
    console.log('GET  /api/products - Get products');
    console.log('POST /api/products/sync - Sync from Clover');
    console.log('GET  /api/inventory - Get inventory');
    console.log('POST /api/checkout - Process payment');
    console.log('POST /webhooks/inventory - Clover inventory webhook');
    console.log('POST /webhooks/payments - Clover payment webhook');
    console.log('POST /webhooks/orders - Clover order webhook');
});

module.exports = app;
