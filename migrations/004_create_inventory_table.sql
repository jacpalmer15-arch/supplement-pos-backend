-- Migration: Create inventory table with Clover sync support
-- Date: 2024-09-13
-- Description: Create inventory table with clover sync support

CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    clover_item_id TEXT, -- Clover item ID for reference
    quantity_available INTEGER DEFAULT 0,
    quantity_on_order INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 10,
    auto_order_enabled BOOLEAN DEFAULT false,
    auto_order_quantity INTEGER DEFAULT 50,
    last_restocked_at TIMESTAMPTZ,
    clover_modified_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'pending', -- 'pending', 'synced', 'error'
    sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one inventory record per product per merchant
    CONSTRAINT unique_merchant_product_inventory UNIQUE (merchant_id, product_id)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_inventory_merchant_id ON inventory(merchant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_clover_item_id ON inventory(clover_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sync_status ON inventory(sync_status);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory(quantity_available, low_stock_threshold);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_inventory_updated_at
    BEFORE UPDATE ON inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_updated_at();

-- Comment on table and columns
COMMENT ON TABLE inventory IS 'Inventory management with Clover sync support';
COMMENT ON COLUMN inventory.clover_item_id IS 'Clover item ID for sync reference';
COMMENT ON COLUMN inventory.sync_status IS 'Sync status: pending, synced, error';
COMMENT ON COLUMN inventory.clover_modified_at IS 'Last modification timestamp from Clover';