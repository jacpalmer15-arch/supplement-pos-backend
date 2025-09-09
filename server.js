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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Environment: ${process.env.NODE_ENV}`);
    console.log(`🏪 Clover Merchant: ${process.env.CLOVER_MERCHANT_ID}`);
});
