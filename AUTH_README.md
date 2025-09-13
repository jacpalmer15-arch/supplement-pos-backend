# Authentication Middleware

This document describes the authentication and authorization middleware implemented for the Supplement POS Backend API.

## Overview

The authentication middleware provides JWT-based authentication with optional Supabase integration. It includes user authentication, merchant context extraction, and role-based access control.

## Middleware Components

### 1. `authenticateToken`

Verifies JWT tokens from the `Authorization` header and extracts user and merchant information.

**Usage:**
```javascript
app.use('/api/protected-route', authenticateToken, routeHandler);
```

**Token Format:**
```
Authorization: Bearer <jwt-token>
```

**JWT Payload Structure:**
```javascript
{
  sub: "user-id",           // User ID
  email: "user@example.com", // User email
  merchant_id: "merchant-id", // Merchant ID
  merchant_name: "Merchant Name", // Merchant name
  role: "admin",            // User role
  iat: 1234567890,          // Issued at
  exp: 1234567890           // Expires at
}
```

### 2. `requireMerchant`

Ensures that merchant context is available in the request. Use after `authenticateToken`.

**Usage:**
```javascript
app.use('/api/merchant-specific', authenticateToken, requireMerchant, routeHandler);
```

### 3. `requireRole(roles)`

Enforces role-based access control. Accepts a single role or array of roles.

**Usage:**
```javascript
// Single role
app.use('/api/admin', authenticateToken, requireRole('admin'), routeHandler);

// Multiple roles
app.use('/api/management', authenticateToken, requireRole(['admin', 'manager']), routeHandler);
```

## Configuration

### Environment Variables

```env
# Required for JWT verification
JWT_SECRET=your-jwt-secret-key

# Optional: Supabase configuration for enhanced JWT verification
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Authentication Modes

1. **Supabase Mode**: If `SUPABASE_URL` and `SUPABASE_ANON_KEY` are configured, the middleware uses Supabase's `auth.getUser()` for token verification.

2. **JWT Mode**: Fallback mode using `JWT_SECRET` for token verification with the `jsonwebtoken` library.

## Implementation Example

```javascript
const { authenticateToken, requireMerchant, requireRole } = require('./src/middleware/auth');

// Public route - no authentication required
app.use('/api/products', productRoutes);

// Protected route - authentication required
app.use('/api/inventory', authenticateToken, requireMerchant, inventoryRoutes);

// Admin-only route
app.get('/api/admin/dashboard', authenticateToken, requireRole(['admin', 'owner']), (req, res) => {
  res.json({
    message: 'Admin dashboard',
    user: req.user,
    merchant: req.merchant
  });
});
```

## Request Object Extensions

After successful authentication, the middleware adds the following to the request object:

### `req.user`
```javascript
{
  id: "user-123",
  email: "user@example.com",
  // ... other user properties from JWT payload
}
```

### `req.merchant`
```javascript
{
  id: "merchant-456",
  name: "Test Merchant",
  role: "admin"
}
```

## Error Responses

### 401 Unauthorized
- No token provided
- Invalid token
- Expired token
- Token verification failed

### 403 Forbidden
- Merchant context required but not available
- Insufficient role permissions

### Example Error Response
```json
{
  "error": "Access token required",
  "message": "Please provide a valid Authorization header with Bearer token"
}
```

## Testing

The middleware can be tested using curl:

```bash
# Test without token (should return 401)
curl http://localhost:3000/api/auth/me

# Test with valid token
curl -H "Authorization: Bearer <jwt-token>" http://localhost:3000/api/auth/me

# Test admin endpoint with admin token
curl -H "Authorization: Bearer <admin-jwt-token>" http://localhost:3000/api/auth/admin
```

## Security Considerations

1. **Token Expiration**: Ensure JWT tokens have appropriate expiration times
2. **Secret Management**: Keep `JWT_SECRET` secure and rotate regularly
3. **HTTPS**: Always use HTTPS in production to protect tokens in transit
4. **Token Storage**: Advise clients to store tokens securely (not in localStorage)
5. **Role Validation**: Validate roles both at the middleware level and within business logic