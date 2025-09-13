-- Migration: Create products table with Clover sync support
-- Date: 2024-09-13
-- Description: Create products table with clover_id for sync operations

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    clover_id TEXT, -- Clover item ID for sync
    name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    sku TEXT,
    upc TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    visible_in_kiosk BOOLEAN DEFAULT true,
    brand TEXT,
    active BOOLEAN DEFAULT true,
    clover_created_at TIMESTAMPTZ,
    clover_modified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for clover sync (allow null clover_id for manually created products)
    CONSTRAINT unique_merchant_clover_product UNIQUE (merchant_id, clover_id),
    
    -- Unique constraint for SKU within merchant (allow null)
    CONSTRAINT unique_merchant_sku UNIQUE (merchant_id, sku),
    
    -- Unique constraint for UPC within merchant (allow null)
    CONSTRAINT unique_merchant_upc UNIQUE (merchant_id, upc)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_clover_id ON products(clover_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
CREATE INDEX IF NOT EXISTS idx_products_visible_in_kiosk ON products(visible_in_kiosk);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_products_updated_at();

-- Comment on table and columns
COMMENT ON TABLE products IS 'Product catalog with Clover sync support';
COMMENT ON COLUMN products.clover_id IS 'Clover item ID for sync operations';
COMMENT ON COLUMN products.clover_created_at IS 'Creation timestamp from Clover';
COMMENT ON COLUMN products.clover_modified_at IS 'Last modification timestamp from Clover';
COMMENT ON COLUMN products.price_cents IS 'Price in cents to avoid floating point issues';