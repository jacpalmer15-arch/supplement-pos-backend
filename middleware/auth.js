/**
 * Supabase JWT Auth Middleware for Express
 * 
 * This middleware verifies JWT tokens from Supabase authentication
 * Expected token format: Authorization: Bearer <token>
 * 
 * Usage:
 *   const auth = require('./middleware/auth');
 *   app.use('/api/protected', auth.requireAuth);
 */

const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client (optional, for additional verification)
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Extract JWT token from Authorization header
 * @param {Object} req - Express request object
 * @returns {string|null} - JWT token or null if not found
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  // Check for Bearer token format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Middleware to require authentication
 * Verifies JWT token and adds user info to req.user
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ 
        error: 'Authorization header missing or invalid format. Expected: Bearer <token>' 
      });
    }

    // JWT Secret for verification (use Supabase JWT secret)
    const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
    
    if (!jwtSecret) {
      console.error('JWT_SECRET or SUPABASE_JWT_SECRET not configured');
      return res.status(500).json({ 
        error: 'Authentication configuration error' 
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError.message);
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: process.env.NODE_ENV === 'development' ? jwtError.message : undefined
      });
    }

    // Extract user information from token
    const user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'user',
      aud: decoded.aud,
      exp: decoded.exp,
      iat: decoded.iat,
      // Add any other claims you need
    };

    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return res.status(401).json({ 
        error: 'Token has expired' 
      });
    }

    // Attach user to request object
    req.user = user;
    req.token = token;

    // Log successful authentication (in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`Authenticated user: ${user.email} (${user.id})`);
    }

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      error: 'Authentication error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Optional middleware for routes that can work with or without authentication
 * If token is provided and valid, adds user to req.user
 * If token is invalid or missing, continues without user
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      // No token provided, continue without authentication
      return next();
    }

    const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
    
    if (!jwtSecret) {
      // Configuration error, but don't block request
      console.error('JWT_SECRET or SUPABASE_JWT_SECRET not configured');
      return next();
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      
      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        // Token expired, continue without auth
        return next();
      }

      // Token is valid, add user info
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'user',
        aud: decoded.aud,
        exp: decoded.exp,
        iat: decoded.iat,
      };
      req.token = token;

    } catch (jwtError) {
      // Invalid token, continue without auth
      console.log('Optional auth - invalid token:', jwtError.message);
    }

    next();

  } catch (error) {
    console.error('Optional auth middleware error:', error);
    // Don't block request on error
    next();
  }
}

/**
 * Middleware to require specific roles
 * Must be used after requireAuth middleware
 * 
 * @param {...string} roles - Required roles
 * @returns {Function} Express middleware function
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const userRole = req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: roles,
        current: userRole
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  extractToken,
};