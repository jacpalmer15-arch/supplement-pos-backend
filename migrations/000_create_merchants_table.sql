-- Migration: Ensure merchants table exists
-- Date: $(date '+%Y-%m-%d %H:%M:%S')
-- Description: Create merchants table if it doesn't exist (prerequisite for clover_tokens)

-- Create merchants table if it doesn't exist
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clover_merchant_id TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups by clover_merchant_id
CREATE INDEX IF NOT EXISTS idx_merchants_clover_merchant_id ON merchants(clover_merchant_id);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_merchants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists and recreate it
DROP TRIGGER IF EXISTS trigger_update_merchants_updated_at ON merchants;
CREATE TRIGGER trigger_update_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW
    EXECUTE FUNCTION update_merchants_updated_at();

-- Comment on table and columns for documentation
COMMENT ON TABLE merchants IS 'Stores merchant information for Clover integration';
COMMENT ON COLUMN merchants.id IS 'Primary key UUID for the merchant';
COMMENT ON COLUMN merchants.clover_merchant_id IS 'Clover merchant ID from Clover API';
COMMENT ON COLUMN merchants.business_name IS 'Business name of the merchant';
COMMENT ON COLUMN merchants.active IS 'Whether this merchant is active';
COMMENT ON COLUMN merchants.created_at IS 'Timestamp when the merchant was created';
COMMENT ON COLUMN merchants.updated_at IS 'Timestamp of last update to this record';