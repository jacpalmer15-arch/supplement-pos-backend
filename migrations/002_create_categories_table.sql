-- Migration: Create categories table with Clover sync support
-- Date: 2024-09-13
-- Description: Create categories table with clover_id for sync operations

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    clover_id TEXT, -- Clover category ID for sync
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    clover_created_at TIMESTAMPTZ,
    clover_modified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for clover sync (allow null clover_id for manually created categories)
    CONSTRAINT unique_merchant_clover_category UNIQUE (merchant_id, clover_id)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_categories_merchant_id ON categories(merchant_id);
CREATE INDEX IF NOT EXISTS idx_categories_clover_id ON categories(clover_id);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW
    EXECUTE FUNCTION update_categories_updated_at();

-- Comment on table and columns
COMMENT ON TABLE categories IS 'Product categories with Clover sync support';
COMMENT ON COLUMN categories.clover_id IS 'Clover category ID for sync operations';
COMMENT ON COLUMN categories.clover_created_at IS 'Creation timestamp from Clover';
COMMENT ON COLUMN categories.clover_modified_at IS 'Last modification timestamp from Clover';