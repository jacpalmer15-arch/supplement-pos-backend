-- Migration: Create inventory table and ensure products table exists
-- Date: 2024-01-01 00:00:00
-- Description: Create inventory table with proper indexes and constraints for inventory management
-- Prerequisites: merchants table must exist (run 000_create_merchants_table.sql first)

-- Create products table if it doesn't exist (for inventory foreign key)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    clover_item_id TEXT,
    item_group_id TEXT,
    category_id UUID,
    name TEXT NOT NULL,
    brand TEXT,
    description TEXT,
    image_url TEXT,
    sku TEXT,
    upc TEXT,
    name_suffix TEXT,
    size TEXT,
    flavor TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER,
    tax_rate_decimal DECIMAL(5,4) DEFAULT 0.0875,
    visible_in_kiosk BOOLEAN DEFAULT true,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(merchant_id, clover_item_id),
    UNIQUE(merchant_id, sku),
    UNIQUE(merchant_id, upc),
    CHECK(price_cents >= 0),
    CHECK(cost_cents IS NULL OR cost_cents >= 0)
);

-- Create inventory table
CREATE TABLE IF NOT EXISTS inventory (
    product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    on_hand INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 5,
    max_stock INTEGER,
    last_counted_at TIMESTAMPTZ,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    sync_source TEXT DEFAULT 'manual',
    
    -- Constraints
    CHECK(on_hand >= 0),
    CHECK(reserved >= 0),
    CHECK(reorder_level >= 0),
    CHECK(max_stock IS NULL OR max_stock >= 0)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_visible_kiosk ON products(visible_in_kiosk);
CREATE INDEX IF NOT EXISTS idx_products_clover_item_id ON products(clover_item_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_on_hand ON inventory(on_hand);
CREATE INDEX IF NOT EXISTS idx_inventory_reorder_level ON inventory(reorder_level);
CREATE INDEX IF NOT EXISTS idx_inventory_last_updated ON inventory(last_updated);

-- Create a composite index for low stock queries
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory(on_hand, reorder_level) 
    WHERE on_hand <= reorder_level;

-- Add triggers to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_inventory_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop triggers if they exist and recreate them
DROP TRIGGER IF EXISTS trigger_update_products_updated_at ON products;
CREATE TRIGGER trigger_update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_products_updated_at();

DROP TRIGGER IF EXISTS trigger_update_inventory_last_updated ON inventory;
CREATE TRIGGER trigger_update_inventory_last_updated
    BEFORE UPDATE ON inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_last_updated();

-- Create categories table if it doesn't exist (referenced by products)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    clover_category_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(merchant_id, clover_category_id)
);

-- Add foreign key constraint for products.category_id if it doesn't exist
ALTER TABLE products 
ADD CONSTRAINT fk_products_category_id 
FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;

-- Create index for categories
CREATE INDEX IF NOT EXISTS idx_categories_merchant_id ON categories(merchant_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(active);

-- Comments for documentation
COMMENT ON TABLE products IS 'Stores product information for each merchant';
COMMENT ON TABLE inventory IS 'Stores inventory levels and stock information for products';
COMMENT ON TABLE categories IS 'Stores product categories for each merchant';

COMMENT ON COLUMN inventory.on_hand IS 'Current available quantity in stock';
COMMENT ON COLUMN inventory.reserved IS 'Quantity reserved for pending orders';
COMMENT ON COLUMN inventory.reorder_level IS 'Minimum stock level before reordering';
COMMENT ON COLUMN inventory.max_stock IS 'Maximum stock level for this product';
COMMENT ON COLUMN inventory.sync_source IS 'Source of last inventory update (manual, sync, adjustment)';

-- Insert some default categories if none exist
INSERT INTO categories (merchant_id, name, sort_order)
SELECT m.id, 'Uncategorized', 999
FROM merchants m
WHERE NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.merchant_id = m.id
)
ON CONFLICT DO NOTHING;