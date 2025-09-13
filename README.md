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

### Inventory API

#### Get All Inventory Items
```http
GET /api/inventory
```

Query Parameters:
- `lowStockOnly` (boolean): Filter to show only items with low stock

Example:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/inventory?lowStockOnly=true"
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "product_id": "123e4567-e89b-12d3-a456-426614174000",
      "product_name": "Whey Protein",
      "sku": "WPP-001",
      "on_hand": 15,
      "reserved": 2,
      "reorder_level": 5,
      "status": "IN_STOCK",
      "last_updated": "2024-01-01T12:00:00Z"
    }
  ],
  "count": 1
}
```

#### Update Inventory Levels
```http
PATCH /api/inventory/:productId
```

Request Body:
```json
{
  "on_hand": 25,
  "reorder_level": 8
}
```

Either `on_hand` or `reorder_level` is required.

Example:
```bash
curl -X PATCH \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"on_hand": 25, "reorder_level": 8}' \
  "http://localhost:3000/api/inventory/123e4567-e89b-12d3-a456-426614174000"
```

#### Get Low Stock Items
```http
GET /api/inventory/low-stock
```

Returns items where `on_hand <= reorder_level`.

### Stock Status Calculation

- **OUT_OF_STOCK**: `on_hand <= 0`
- **LOW_STOCK**: `on_hand <= reorder_level` and `on_hand > 0`
- **IN_STOCK**: `on_hand > reorder_level`

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
- `PORT`: Server port (default: 3000)

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
