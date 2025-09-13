// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client for JWT verification
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Authentication middleware for verifying Supabase JWT tokens
 * Extracts user and merchant information from the token
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid Authorization header with Bearer token'
      });
    }

    // If Supabase is configured, use it for verification
    if (supabase) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (error || !user) {
        return res.status(401).json({ 
          error: 'Invalid token',
          message: 'Token verification failed'
        });
      }

      // Extract user information
      req.user = {
        id: user.id,
        email: user.email,
        ...user.user_metadata
      };

      // Extract merchant context if available in user metadata or app metadata
      req.merchant = {
        id: user.user_metadata?.merchant_id || user.app_metadata?.merchant_id,
        name: user.user_metadata?.merchant_name || user.app_metadata?.merchant_name,
        role: user.user_metadata?.role || user.app_metadata?.role || 'user'
      };

    } else {
      // Fallback to JWT verification using the JWT_SECRET
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({ 
          error: 'Server configuration error',
          message: 'JWT verification not properly configured'
        });
      }

      const decoded = jwt.verify(token, jwtSecret);
      
      // Extract user information from JWT payload
      req.user = {
        id: decoded.sub || decoded.user_id || decoded.id,
        email: decoded.email,
        ...decoded
      };

      // Extract merchant context
      req.merchant = {
        id: decoded.merchant_id,
        name: decoded.merchant_name,
        role: decoded.role || 'user'
      };
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Token is malformed or invalid'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Please refresh your authentication token'
      });
    }
    
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Unable to verify token'
    });
  }
};

/**
 * Middleware to require merchant context
 * Use this after authenticateToken to ensure merchant information is available
 */
const requireMerchant = (req, res, next) => {
  if (!req.merchant || !req.merchant.id) {
    return res.status(403).json({ 
      error: 'Merchant context required',
      message: 'This endpoint requires valid merchant information'
    });
  }
  next();
};

/**
 * Middleware to require specific roles
 * @param {string|string[]} roles - Required role(s)
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    if (!req.merchant || !req.merchant.role) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Role information not available'
      });
    }

    if (!allowedRoles.includes(req.merchant.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `This endpoint requires one of the following roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireMerchant,
  requireRole
};