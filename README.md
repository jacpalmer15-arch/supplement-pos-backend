# supplement-pos-backend

Backend API for Supplement Shop POS - A comprehensive Point of Sale system for supplement retailers.

## Features

- **Products API**: Complete CRUD operations for product management
- **Multi-tenant Architecture**: Secure merchant isolation via JWT authentication
- **Inventory Management**: Real-time stock tracking and management
- **Clover Integration**: Sync with Clover POS systems
- **Supabase Authentication**: JWT-based authentication with Supabase
- **PostgreSQL Database**: Robust data storage with proper relationships

## Quick Start

### Prerequisites

- Node.js (v16+)
- PostgreSQL database
- Clover merchant account (for sync features)
- Supabase project (for authentication)

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd supplement-pos-backend
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development server
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Documentation

### Authentication

All API routes require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Sync API

#### Full Clover Sync
```http
POST /api/sync/full
```

Performs a complete synchronization of categories, products (items), and inventory from Clover POS to the local database for the authenticated merchant.

**Authentication**: Required (Bearer token with merchant context)

**Feature Flag**: Controlled by `ENABLE_CLOVER` environment variable

**Response Format**:
```json
{
  "success": true,
  "message": "Full sync completed successfully",
  "enabled": true,
  "duration": "2340ms",
  "categories": {
    "success": true,
    "processed": 5,
    "errors": null
  },
  "products": {
    "success": true,
    "processed": 23,
    "errors": null
  },
  "inventory": {
    "success": true,
    "processed": 23,
    "errors": null
  },
  "timestamp": "2024-09-13T12:00:00.000Z"
}
```

**Error Responses**:
- `400` - No Clover access token found for merchant
- `401` - Clover access token expired
- `403` - Insufficient permissions or missing merchant context
- `404` - Merchant account not found
- `500` - Sync operation failed

**Feature Disabled Response** (when `ENABLE_CLOVER=false`):
```json
{
  "success": true,
  "message": "Clover sync is currently disabled",
  "enabled": false,
  "categories": { "processed": 0 },
  "products": { "processed": 0 },
  "inventory": { "processed": 0 }
}
```

Example:
```bash
curl -X POST \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/sync/full"
```

#### Sync Status
```http
GET /api/sync/status
```

Check the current sync status and token validation for the authenticated merchant.

**Authentication**: Required

**Response Format**:
```json
{
  "success": true,
  "enabled": true,
  "merchant_id": "123e4567-e89b-12d3-a456-426614174000",
  "token_status": "valid",
  "timestamp": "2024-09-13T12:00:00.000Z"
}
```

**Token Status Values**:
- `valid` - Token exists and is not expired
- `missing` - No Clover token found for merchant
- `expired` - Token exists but has expired
- `error` - Error checking token status

### Products API

#### Get All Products
```http
GET /api/products
```

Query Parameters:
- `search` (string): Search in product name, brand, SKU, or UPC
- `categoryId` (UUID): Filter by category ID
- `visibleInKiosk` (boolean): Filter by kiosk visibility

Example:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/products?search=protein&visibleInKiosk=true"
```

#### Get Single Product
```http
GET /api/products/:id
```

Example:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/products/123e4567-e89b-12d3-a456-426614174000"
```

#### Create Product
```http
POST /api/products
```

Request Body:
```json
{
  "name": "Whey Protein Powder",
  "description": "High-quality whey protein supplement",
  "price_cents": 4999,
  "sku": "WPP-001",
  "upc": "123456789012",
  "category_id": "uuid-of-category",
  "visible_in_kiosk": true,
  "brand": "Premium Supplements"
}
```

Required fields: `name`, `price_cents`

#### Update Product
```http
PATCH /api/products/:id
```

Request Body (partial update):
```json
{
  "name": "Updated Product Name",
  "price_cents": 5999,
  "visible_in_kiosk": false
}
```

#### Delete Product
```http
DELETE /api/products/:id
```

Note: Deletion will be prevented if the product is referenced by existing orders.

### Legacy Endpoints (Backward Compatibility)

#### Sync Products from Clover
```http
POST /api/products/sync?limit=100
```

#### Search Products
```http
GET /api/products/search/:query
```

### Response Format

All responses follow this format:

Success:
```json
{
  "success": true,
  "data": { /* response data */ },
  "count": 10 // for list endpoints
}
```

Error:
```json
{
  "success": false,
  "error": "Error message description"
}
```

## Database Schema

### Core Tables

- **merchants**: Multi-tenant merchant information
- **categories**: Product categories
- **products**: Main product catalog
- **inventory**: Stock levels and inventory management

### Multi-Tenant Security

All data access is automatically filtered by `merchant_id` based on the authenticated user's JWT token, ensuring complete data isolation between merchants.

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

The test suite includes:
- Authentication middleware tests
- Complete CRUD operation tests
- Multi-tenant isolation verification
- Input validation tests
- Error handling tests

## Development Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT token verification
- `CLOVER_*`: Clover POS integration settings
- `ENABLE_CLOVER`: Feature flag to enable/disable Clover sync (default: false)
- `PORT`: Server port (default: 3000)

### Clover Sync Configuration

The Clover sync functionality is controlled by the `ENABLE_CLOVER` feature flag:

```env
# Enable Clover sync features
ENABLE_CLOVER=true

# Clover API configuration
CLOVER_APP_ID=your_clover_app_id
CLOVER_APP_SECRET=your_clover_app_secret
CLOVER_ENVIRONMENT=sandbox
CLOVER_BASE_URL=https://sandbox.dev.clover.com
```

**Important**: When `ENABLE_CLOVER=false`, all sync endpoints return stubbed responses without making API calls.

### Database Setup

The application requires these database tables with Clover sync support:
- `merchants` - Merchant information with clover_merchant_id
- `clover_tokens` - OAuth tokens for Clover API access
- `categories` - Product categories with clover_id for sync
- `products` - Product catalog with clover_id for sync  
- `inventory` - Inventory levels with Clover sync tracking

Run migrations to set up the schema:
```bash
node migrations/run-migrations.js
```

### Clover Integration Setup

1. **Merchant Setup**: Merchants must be created with valid `clover_merchant_id`
2. **Token Management**: OAuth tokens stored in `clover_tokens` table per merchant
3. **Sync Process**: Categories → Products → Inventory (in sequence)
4. **Idempotency**: All sync operations use upsert logic for safe re-runs

### Troubleshooting Sync Issues

**Token Issues**:
- `400 No Clover access token found`: Merchant needs to authenticate with Clover OAuth
- `401 Token expired`: Use refresh token or re-authenticate with Clover
- `403 Merchant context required`: Ensure JWT token includes merchant_id

**API Issues**:
- Check `CLOVER_BASE_URL` matches your Clover environment (sandbox/production)
- Verify `clover_merchant_id` matches the authenticated Clover account
- Ensure token has sufficient scopes for inventory and catalog access

**Database Issues**:
- Run migrations to ensure proper table schema with clover_id columns
- Check for unique constraint violations on SKU/UPC fields
- Verify merchant_id associations are correct

**Feature Flag Issues**:
- When `ENABLE_CLOVER=false`, all sync operations return stubbed responses
- Check environment variable is set correctly (case-sensitive)
- Restart server after changing feature flag settings

## Error Codes

- `400` - Bad Request (validation errors, malformed data)
- `401` - Unauthorized (missing or invalid auth token)
- `403` - Forbidden (access denied, merchant mismatch)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate SKU/UPC, deletion conflicts)
- `500` - Internal Server Error

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

This project is proprietary software. All rights reserved.
