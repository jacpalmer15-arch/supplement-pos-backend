# Zenith Solution Self-Checkout Backend Infrastructure

This document describes the newly implemented backend infrastructure for the Zenith Solution Self-Checkout system.

## New Features

### 1. Database Schema

#### Clover Tokens Table
A new `clover_tokens` table has been added to store Clover OAuth tokens for merchant authentication:

```sql
CREATE TABLE clover_tokens (
    merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT DEFAULT 'bearer',
    scope TEXT,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Database Migrations

Migration files are located in the `migrations/` directory:

- `000_create_merchants_table.sql` - Ensures merchants table exists
- `001_create_clover_tokens_table.sql` - Creates the clover_tokens table

#### Running Migrations

```bash
node migrations/run-migrations.js
```

The migration runner will:
- Execute all `.sql` files in alphabetical order
- Run everything in a single transaction
- Rollback on any error

### 3. Supabase JWT Authentication Middleware

A new authentication middleware has been implemented at `middleware/auth.js` for verifying Supabase JWT tokens.

#### Features:
- **Token Extraction**: Parses `Authorization: Bearer <token>` headers
- **JWT Verification**: Validates tokens using configurable secret
- **User Context**: Adds user info to `req.user` object
- **Role-based Access**: Support for role-based authorization
- **Optional Authentication**: Flexible middleware for public/private routes

#### Usage Examples:

```javascript
const { requireAuth, optionalAuth, requireRole } = require('./middleware/auth');

// Protected route
app.get('/api/protected', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Admin only route
app.get('/api/admin', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ message: 'Admin access granted' });
});

// Optional auth route
app.get('/api/optional', optionalAuth, (req, res) => {
  res.json({ 
    authenticated: !!req.user,
    user: req.user || null 
  });
});
```

## Environment Variables

Make sure to configure these environment variables:

```env
# JWT Authentication
JWT_SECRET=your-jwt-secret-key
# OR
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# Optional: For additional Supabase features
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Database (existing)
DATABASE_URL=postgresql://...
```

## Security Considerations

1. **JWT Secret**: Use a strong, unique secret for JWT verification
2. **Token Expiration**: Tokens are checked for expiration automatically
3. **HTTPS**: Always use HTTPS in production for token transmission
4. **Error Handling**: Sensitive error details are only shown in development mode

## API Response Formats

### Successful Authentication
```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "role": "user",
    "exp": 1640995200,
    "iat": 1640908800
  }
}
```

### Authentication Errors
```json
{
  "error": "Invalid or expired token",
  "details": "jwt expired" // only in development
}
```

### Authorization Errors
```json
{
  "error": "Insufficient permissions",
  "required": ["admin"],
  "current": "user"
}
```

## Testing the Implementation

Example routes are provided in `routes/auth-example.js` to test the middleware:

- `GET /public` - No authentication required
- `GET /protected` - Requires valid JWT token
- `GET /optional` - Works with or without token
- `GET /admin` - Requires admin role
- `GET /me` - Returns current user info

## Dependencies Added

- `jsonwebtoken` - JWT token verification
- `@supabase/supabase-js` - Supabase client library

## Next Steps

1. Run the database migrations to create the new tables
2. Configure your JWT secret in environment variables
3. Integrate the auth middleware into your existing routes as needed
4. Test the authentication flow with your Supabase setup