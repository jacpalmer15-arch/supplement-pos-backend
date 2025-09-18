-- Migration: Create orders and transaction tables
-- Date: 2024-09-18
-- Description: Create orders/transactions and related tables for POS system

-- Orders table (main transaction records)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id TEXT UNIQUE, -- Clover order ID or external system ID
    order_number TEXT, -- Human-readable order number
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'refunded')),
    
    -- Customer information
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    
    -- Pricing breakdown
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    
    -- Payment information
    payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid', 'refunded')),
    payment_method TEXT, -- 'cash', 'card', 'clover', etc.
    payment_reference TEXT, -- Payment gateway reference
    
    -- Timestamps
    order_date TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Device/source information
    device_serial TEXT,
    source TEXT DEFAULT 'pos' -- 'pos', 'kiosk', 'online', etc.
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    
    -- Product snapshot data (in case product is deleted later)
    product_name TEXT NOT NULL,
    product_sku TEXT,
    variant_info TEXT, -- Size, flavor, etc.
    
    -- Pricing and quantity
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure line total matches calculation
    CONSTRAINT check_line_total CHECK (line_total_cents = quantity * unit_price_cents)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- Add triggers to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_orders_updated_at();

-- Function to generate order numbers
CREATE OR REPLACE FUNCTION generate_order_number(merchant_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    order_count INTEGER;
    date_prefix TEXT;
    order_number TEXT;
BEGIN
    -- Get current date in YYMMDD format
    date_prefix := TO_CHAR(NOW(), 'YYMMDD');
    
    -- Count orders for this merchant today
    SELECT COUNT(*) INTO order_count
    FROM orders 
    WHERE merchant_id = merchant_uuid 
    AND DATE(created_at) = CURRENT_DATE;
    
    -- Generate order number: YYMMDD-####
    order_number := date_prefix || '-' || LPAD((order_count + 1)::TEXT, 4, '0');
    
    RETURN order_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate order numbers
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL THEN
        NEW.order_number := generate_order_number(NEW.merchant_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION set_order_number();

-- Comments on tables and columns
COMMENT ON TABLE orders IS 'Main order/transaction records for POS system';
COMMENT ON COLUMN orders.external_id IS 'External system ID (e.g., Clover order ID)';
COMMENT ON COLUMN orders.order_number IS 'Human-readable order number (auto-generated)';
COMMENT ON COLUMN orders.source IS 'Source of the order (pos, kiosk, online, etc.)';

COMMENT ON TABLE order_items IS 'Individual items within an order';
COMMENT ON COLUMN order_items.variant_info IS 'Product variant information (size, flavor, etc.)';
COMMENT ON COLUMN order_items.line_total_cents IS 'Total for this line item (quantity * unit_price_cents)';