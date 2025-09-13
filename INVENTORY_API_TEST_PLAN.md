# Inventory API Test Plan

## Overview
This test plan covers the newly implemented Inventory API endpoints with authentication, validation, and multi-tenant isolation.

## Test Environment Setup

### Prerequisites
- PostgreSQL database running
- Environment variables configured (JWT_SECRET, DATABASE_URL)
- Server started: `npm run dev`

### Test Data Setup
- Create test merchant in database
- Create test products with inventory records
- Generate valid JWT tokens with merchant context

## API Endpoint Tests

### 1. Authentication Tests

#### Test 1.1: Missing Authorization Header
```bash
curl -X GET http://localhost:3000/api/inventory
# Expected: 401 Unauthorized with "Access token required" message
```

#### Test 1.2: Invalid JWT Token
```bash
curl -H "Authorization: Bearer invalid-token" \
     http://localhost:3000/api/inventory
# Expected: 401 Unauthorized with "Invalid token" message
```

#### Test 1.3: Valid JWT Token
```bash
curl -H "Authorization: Bearer <valid-jwt-token>" \
     http://localhost:3000/api/inventory
# Expected: 200 OK with inventory data
```

### 2. GET /api/inventory Tests

#### Test 2.1: List All Inventory Items
```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:3000/api/inventory
# Expected: 200 OK with array of inventory items
# Verify: Each item has product_id, product_name, on_hand, reorder_level, status
```

#### Test 2.2: Filter Low Stock Only
```bash
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/inventory?lowStockOnly=true"
# Expected: 200 OK with only items where on_hand <= reorder_level
# Verify: All returned items have status "LOW_STOCK" or "OUT_OF_STOCK"
```

#### Test 2.3: Merchant Isolation
```bash
# Use JWT token for different merchant
curl -H "Authorization: Bearer <other-merchant-token>" \
     http://localhost:3000/api/inventory
# Expected: 200 OK with empty array (no access to other merchant's inventory)
```

### 3. PATCH /api/inventory/:productId Tests

#### Test 3.1: Update On-Hand Quantity
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": 25}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 200 OK with updated inventory data
# Verify: on_hand field is updated, status calculated correctly
```

#### Test 3.2: Update Reorder Level
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"reorder_level": 10}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 200 OK with updated reorder_level
```

#### Test 3.3: Update Both Fields
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": 30, "reorder_level": 8}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 200 OK with both fields updated
```

#### Test 3.4: Invalid Product ID Format
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": 15}' \
     http://localhost:3000/api/inventory/invalid-id
# Expected: 400 Bad Request with "Invalid product ID format"
```

#### Test 3.5: Non-existent Product
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": 15}' \
     http://localhost:3000/api/inventory/00000000-0000-0000-0000-000000000000
# Expected: 404 Not Found with "Product not found"
```

#### Test 3.6: Negative Quantities
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": -5}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 400 Bad Request with validation error
```

#### Test 3.7: No Update Fields Provided
```bash
curl -X PATCH \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 400 Bad Request with "Either on_hand or reorder_level must be provided"
```

#### Test 3.8: Merchant Isolation for Updates
```bash
curl -X PATCH \
     -H "Authorization: Bearer <other-merchant-token>" \
     -H "Content-Type: application/json" \
     -d '{"on_hand": 100}' \
     http://localhost:3000/api/inventory/<valid-product-id>
# Expected: 404 Not Found (product not accessible to other merchant)
```

### 4. GET /api/inventory/low-stock Tests

#### Test 4.1: Get Low Stock Items
```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:3000/api/inventory/low-stock
# Expected: 200 OK with items where on_hand <= reorder_level
# Verify: Backward compatibility with existing endpoint
```

#### Test 4.2: Merchant Isolation
```bash
curl -H "Authorization: Bearer <other-merchant-token>" \
     http://localhost:3000/api/inventory/low-stock
# Expected: 200 OK with empty array (no access to other merchant's data)
```

## Stock Status Verification Tests

### Test Stock Status Calculations
1. Set on_hand = 0 → Verify status = "OUT_OF_STOCK"
2. Set on_hand = 3, reorder_level = 5 → Verify status = "LOW_STOCK"  
3. Set on_hand = 15, reorder_level = 5 → Verify status = "IN_STOCK"

## Database Transaction Tests

### Test Rollback on Error
1. Attempt update with invalid data after valid product lookup
2. Verify no partial updates occur (transaction rollback)

## Performance Tests (Optional)

### Large Dataset Test
1. Create 1000+ products with inventory
2. Test response time for GET /api/inventory
3. Verify pagination may be needed for large datasets

## Integration Tests

### Test with Real Database
1. Run full test suite: `npm test`
2. Verify all integration tests pass
3. Check database state after tests complete

## Manual Testing Checklist

- [ ] Authentication works with valid/invalid tokens
- [ ] GET /api/inventory returns correct data structure
- [ ] lowStockOnly filter works correctly
- [ ] PATCH updates work for both on_hand and reorder_level  
- [ ] Validation errors return appropriate status codes
- [ ] Merchant isolation prevents cross-tenant access
- [ ] Stock status calculations are accurate
- [ ] Database transactions handle errors properly
- [ ] Backward compatibility maintained for existing endpoints

## Expected Results Summary

| Test Category | Expected Pass Rate |
|--------------|-------------------|
| Authentication | 100% |
| GET Endpoints | 100% |
| PATCH Validations | 100% |
| Merchant Isolation | 100% |
| Error Handling | 100% |
| Stock Status Logic | 100% |

## Test Data Requirements

### Minimum Test Data:
- 2 merchants with different IDs
- 5 products per merchant (different stock levels)
- JWT tokens for each merchant
- Products with: OUT_OF_STOCK, LOW_STOCK, and IN_STOCK status

### Database State:
- Clean setup before tests
- Proper cleanup after tests
- No side effects between test runs