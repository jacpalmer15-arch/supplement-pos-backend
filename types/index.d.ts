// types/index.d.ts
// TypeScript definitions for the Supplement POS Backend

export interface Merchant {
  id: string;
  name: string;
  clover_merchant_id?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  merchant_id: string;
  clover_id?: string;
  name: string;
  sort_order: number;
  active: boolean;
  clover_created_at?: string;
  clover_modified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  merchant_id: string;
  category_id?: string;
  clover_item_id?: string;
  item_group_id?: string;
  name: string;
  name_suffix?: string;
  brand?: string;
  description?: string;
  sku?: string;
  upc?: string;
  size?: string;
  flavor?: string;
  price_cents: number;
  tax_rate_decimal?: number;
  cost_cents?: number;
  visible_in_kiosk: boolean;
  active: boolean;
  clover_created_at?: string;
  clover_modified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Inventory {
  id: string;
  merchant_id: string;
  product_id: string;
  clover_item_stock_id?: string;
  on_hand: number;
  reserved: number;
  reorder_level: number;
  last_updated: string;
  status: 'active' | 'inactive';
  stock_status?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

export interface Order {
  id: string;
  merchant_id: string;
  external_id?: string;
  order_number: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  payment_status: 'unpaid' | 'paid' | 'partially_paid' | 'refunded';
  payment_method?: string;
  payment_reference?: string;
  order_date: string;
  completed_at?: string;
  cancelled_at?: string;
  created_at: string;
  updated_at: string;
  device_serial?: string;
  source: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id?: string;
  product_name: string;
  product_sku?: string;
  variant_info?: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
  user: User;
  merchant: {
    id: string;
    name?: string;
    role: string;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Product filters for API requests
export interface ProductFilters {
  search?: string;
  categoryId?: string;
  visibleInKiosk?: boolean;
  merchantId: string;
}

// Inventory filters
export interface InventoryFilters {
  lowStockOnly?: boolean;
}

// Order filters
export interface OrderFilters {
  status?: string;
  payment_status?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// Checkout request types
export interface CartItem {
  productId: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Cart {
  items: CartItem[];
}

export interface CheckoutRequest {
  cart: Cart;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  payment_method?: string;
  device_serial?: string;
}

// Sync related types
export interface SyncResult {
  success: boolean;
  categoriesUpserted: number;
  productsUpserted: number;
  inventoryUpserted: number;
  errors: string[];
}

export interface CloverToken {
  id: string;
  merchant_id: string;
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at?: string;
  scope?: string;
  created_at: string;
  updated_at: string;
}

// Database client interface
export interface DatabaseClient {
  query(text: string, params?: any[]): Promise<any>;
  release(): void;
}

// Common validation interfaces
export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}