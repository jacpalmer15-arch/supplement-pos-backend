// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');

/**
 * Middleware to verify Supabase JWT token and extract merchant context
 * Expects Authorization: Bearer <token> header
 */
const authenticateSupabaseJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authorization header with Bearer token required' 
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify JWT token (using JWT_SECRET from .env)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Extract user information from token
    const userId = decoded.sub || decoded.user_id;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token: missing user ID' 
      });
    }

    // For now, we'll use a simple mapping. In production, this would query
    // the user-merchant relationship from the database
    // For testing purposes, we'll use a default merchant or extract from token
    let merchantId = decoded.merchant_id;
    
    if (!merchantId) {
      // Try to get merchant from database or use default for testing
      const client = await db.connect();
      try {
        const result = await client.query(
          'SELECT id FROM merchants WHERE active = true LIMIT 1'
        );
        if (result.rows.length > 0) {
          merchantId = result.rows[0].id;
        } else {
          return res.status(403).json({ 
            success: false, 
            error: 'No active merchant found for user' 
          });
        }
      } finally {
        client.release();
      }
    }

    // Add user and merchant info to request object
    req.user = {
      id: userId,
      merchantId: merchantId,
      ...decoded
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired' 
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: 'Authentication error' 
      });
    }
  }
};

module.exports = {
  authenticateSupabaseJWT
};