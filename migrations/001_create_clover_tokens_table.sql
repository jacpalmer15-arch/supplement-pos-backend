-- Migration: Create clover_tokens table
-- Date: $(date '+%Y-%m-%d %H:%M:%S')
-- Description: Create table to store Clover OAuth tokens for merchant authentication
-- Prerequisites: merchants table must exist (run 000_create_merchants_table.sql first)

CREATE TABLE IF NOT EXISTS clover_tokens (
    merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT DEFAULT 'bearer',
    scope TEXT,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_clover_tokens_merchant_id ON clover_tokens(merchant_id);

-- Create index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_clover_tokens_expires_at ON clover_tokens(expires_at);

-- Add a trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_clover_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_clover_tokens_updated_at
    BEFORE UPDATE ON clover_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_clover_tokens_updated_at();

-- Comment on table and columns for documentation
COMMENT ON TABLE clover_tokens IS 'Stores Clover OAuth tokens for merchant authentication';
COMMENT ON COLUMN clover_tokens.merchant_id IS 'Foreign key reference to merchants table';
COMMENT ON COLUMN clover_tokens.access_token IS 'OAuth access token for Clover API calls';
COMMENT ON COLUMN clover_tokens.refresh_token IS 'OAuth refresh token to renew access token';
COMMENT ON COLUMN clover_tokens.token_type IS 'OAuth token type, typically "bearer"';
COMMENT ON COLUMN clover_tokens.scope IS 'OAuth scope granted for this token';
COMMENT ON COLUMN clover_tokens.expires_at IS 'Timestamp when the access token expires';
COMMENT ON COLUMN clover_tokens.updated_at IS 'Timestamp of last update to this record';