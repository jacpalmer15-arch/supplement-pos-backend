Supplement POS Backend API Documentation
=======================================
Generated: 2025-09-18 
Version: 2.0 (Comprehensive Refactor)

## Authentication
All protected routes require JWT authentication via `Authorization: Bearer <token>` header.
Multi-tenant security ensures data isolation by merchant_id from JWT token.

## Base URL
Development: http://localhost:3000
Production: [Your production URL]

## Conventions
- All responses are JSON
- Success: `{ "success": true, "data": <result>, "count": <number>? }`
- Error: `{ "success": false, "error": "<message>", "message": "<details>?" }`
- Timestamps: ISO-8601
- Prices: integer cents
- UUIDs: standard UUID v4 format

## Health & Status Endpoints
- `GET /` - Service status and environment info
- `GET /api/health/ping` - Health check ping
- `GET /api/health/dns` - DNS resolution test  
- `GET /api/health/db` - Database connection test

## Authentication Endpoints
- `GET /api/auth/me` - Get current user info (requires auth)
- `GET /api/auth/admin` - Admin-only test route (requires auth + admin role)

## Products API
**Base Path:** `/api/products` (requires auth)

- `GET /api/products` - List products with filters
  - Query params:
    - `search=<string>` - Search by name/brand/sku/upc
    - `categoryId=<uuid>` - Filter by category
    - `visibleInKiosk=<boolean>` - Filter kiosk-visible items
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create new product
- `PATCH /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product
- `GET /api/products/search/:query` - Convenience search endpoint
- `POST /api/products/sync` - Sync products from Clover (legacy)

## Categories API  
**Base Path:** `/api/categories` (requires auth)

- `GET /api/categories` - List all categories
- `GET /api/categories/:id` - Get single category
- `POST /api/categories` - Create new category
- `PATCH /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category (if no products)

## Inventory API
**Base Path:** `/api/inventory` (requires auth)

- `GET /api/inventory` - List inventory with product details
  - Query params: `lowStockOnly=<boolean>`
- `PATCH /api/inventory/:productId` - Update inventory levels
- `GET /api/inventory/low-stock` - Get low stock items only

## Orders API
**Base Path:** `/api/orders` (requires auth)

- `GET /api/orders` - List orders with filtering and pagination
  - Query params:
    - `status=<string>` - Filter by order status
    - `payment_status=<string>` - Filter by payment status
    - `start_date=<date>` - Filter by order date (from)
    - `end_date=<date>` - Filter by order date (to)
    - `search=<string>` - Search by order number, customer name/email
    - `page=<number>` - Page number (default: 1)
    - `limit=<number>` - Items per page (default: 50, max: 100)
- `GET /api/orders/:id` - Get single order with items
- `PATCH /api/orders/:id/status` - Update order status and/or payment status
- `GET /api/orders/stats/summary` - Get order statistics

## Checkout API
**Base Path:** `/api/checkout` (requires auth)

- `POST /api/checkout` - Process complete checkout with cart items

## Sync API (Clover Integration)
**Base Path:** `/api/sync` (requires auth)

- `POST /api/sync/full` - Perform full Clover sync
- `GET /api/sync/status` - Get sync status

## Webhooks (Public)
**Base Path:** `/api/webhooks` (no auth required)

- Various Clover webhook endpoints for real-time sync

## Example Requests

### Create Category
```bash
curl -X POST http://localhost:3000/api/categories \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Protein Supplements", "sort_order": 1}'
```

### List Products
```bash
curl "http://localhost:3000/api/products?search=protein&visibleInKiosk=true" \
  -H "Authorization: Bearer <token>"
```

### Create Order
```bash
curl -X POST http://localhost:3000/api/checkout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "cart": {
      "items": [
        {
          "productId": "product-uuid",
          "quantity": 2,
          "unit_price_cents": 2999
        }
      ]
    },
    "customer_name": "John Doe",
    "payment_method": "card"
  }'
```

### Get Order Statistics
```bash
curl "http://localhost:3000/api/orders/stats/summary?start_date=2024-01-01&end_date=2024-12-31" \
  -H "Authorization: Bearer <token>"
```

## Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (insufficient permissions) 
- `404` - Not Found
- `409` - Conflict (duplicate data, constraint violations)
- `500` - Internal Server Error

## Data Models

See `/types/index.d.ts` for complete TypeScript definitions.

### Key Models:
- **Product** - Core product information with pricing and categorization
- **Category** - Product categories with sort ordering
- **Order** - Complete order records with status tracking
- **OrderItem** - Individual items within orders
- **Inventory** - Stock levels and reorder management
- **Merchant** - Multi-tenant merchant isolation

## Environment Variables
See `.env.example` for all required configuration:
- Database connection (DATABASE_URL)
- JWT secrets (JWT_SECRET)
- Supabase config (SUPABASE_URL, SUPABASE_ANON_KEY)
- Clover POS integration (CLOVER_*)
- Feature flags (ENABLE_CLOVER)