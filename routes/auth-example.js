// Example route using the auth middleware
// This file demonstrates how to use the Supabase JWT auth middleware

const express = require('express');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// Public route - no authentication required
router.get('/public', (req, res) => {
  res.json({ 
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString()
  });
});

// Protected route - requires valid JWT token
router.get('/protected', requireAuth, (req, res) => {
  res.json({
    message: 'This is a protected endpoint',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Optional auth route - works with or without token
router.get('/optional', optionalAuth, (req, res) => {
  res.json({
    message: 'This endpoint works with or without authentication',
    authenticated: !!req.user,
    user: req.user || null,
    timestamp: new Date().toISOString()
  });
});

// Admin-only route - requires auth + admin role
router.get('/admin', requireAuth, requireRole('admin'), (req, res) => {
  res.json({
    message: 'This is an admin-only endpoint',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

// Route to get current user info
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    token_expires: new Date(req.user.exp * 1000).toISOString()
  });
});

module.exports = router;