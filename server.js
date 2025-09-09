const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Only import files that exist
const productRoutes = require('./supplement-pos-backend/routes/products.js');

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

// Only use routes that exist
app.use('/api/products', productRoutes);

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
