// ==================================================
// FILE: services/productService.js (Product Data Management)
// ==================================================
const db = require('../config/database');
const cloverService = require('./cloverService');

class ProductService {
    // Sync all products from Clover to our database
    async syncAllProducts() {
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');
            
            console.log('🔄 Starting product sync from Clover...');
            
            // Get merchant ID
            const merchantResult = await client.query(
                'SELECT id FROM merchants WHERE clover_merchant_id = $1',
                [process.env.CLOVER_MERCHANT_ID]
            );
            
            if (merchantResult.rows.length === 0) {
                throw new Error('Merchant not found in database');
            }
            
            const merchantId = merchantResult.rows[0].id;
            
            // Fetch items from Clover
            const cloverItems = await cloverService.getItems();
            console.log(`📥 Processing ${cloverItems.length} items from Clover`);
            
            let syncedProducts = 0;
            let syncedSkus = 0;
            
            for (const item of cloverItems) {
                // Skip items without basic info
                if (!item.id || !item.name) {
                    console.log(`⚠️ Skipping item without ID or name:`, item);
                    continue;
                }
                
                // Upsert product
                const productResult = await client.query(`
                    INSERT INTO products (
                        merchant_id, clover_item_id, name, 
                        base_price_cents, active, has_variants
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (clover_item_id) 
                    DO UPDATE SET 
                        name = EXCLUDED.name,
                        base_price_cents = EXCLUDED.base_price_cents,
                        active = EXCLUDED.active,
                        updated_at = NOW()
                    RETURNING id
                `, [
                    merchantId,
                    item.id,
                    item.name,
                    item.price || 0,
                    !item.hidden,
                    false // Start with no variants, we'll update if needed
                ]);
                
                const productId = productResult.rows[0].id;
                syncedProducts++;
                
                // Check if item has variants
                const variants = await cloverService.getItemVariants(item.id);
                
                if (variants && variants.length > 0) {
                    // Product has variants - update product and create variant SKUs
                    await client.query(
                        'UPDATE products SET has_variants = true WHERE id = $1',
                        [productId]
                    );
                    
                    for (const variant of variants) {
                        await this.upsertSku(client, productId, item, variant, false);
                        syncedSkus++;
                    }
                } else {
                    // Single product - create one SKU
                    await this.upsertSku(client, productId, item, null, true);
                    syncedSkus++;
                }
            }
            
            // Now sync inventory levels
            await this.syncInventoryLevels(client);
            
            await client.query('COMMIT');
            
            console.log(`✅ Sync complete: ${syncedProducts} products, ${syncedSkus} SKUs`);
            return {
                success: true,
                productssynced: syncedProducts,
                skussynced: syncedSkus
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Product sync failed:', error);
            throw error;
        } finally {
            client.release();
        }
    }
    
    // Helper function to create/update SKU records
    async upsertSku(client, productId, cloverItem, cloverVariant, isIndividual) {
        const sku = cloverVariant ? cloverVariant.sku : cloverItem.code || cloverItem.id;
        const price = cloverVariant ? cloverVariant.price : cloverItem.price;
        const name = cloverVariant ? cloverVariant.name : null;
        const variantId = cloverVariant ? cloverVariant.id : cloverItem.id;
        
        const skuResult = await client.query(`
            INSERT INTO skus (
                product_id, clover_variant_id, sku, name_suffix,
                price_cents, is_individual, visible_in_kiosk, active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (clover_variant_id) 
            DO UPDATE SET 
                sku = EXCLUDED.sku,
                name_suffix = EXCLUDED.name_suffix,
                price_cents = EXCLUDED.price_cents,
                active = EXCLUDED.active,
                updated_at = NOW()
            RETURNING id
        `, [
            productId,
            variantId,
            sku,
            name,
            price || 0,
            isIndividual,
            true, // Default to visible in kiosk
            true  // Default to active
        ]);
        
        return skuResult.rows[0].id;
    }
    
    // Sync inventory levels from Clover
    async syncInventoryLevels(client) {
        try {
            const cloverInventory = await cloverService.getInventory();
            console.log(`📊 Syncing inventory for ${cloverInventory.length} items`);
            
            for (const invItem of cloverInventory) {
                await client.query(`
                    INSERT INTO inventory (sku_id, on_hand, last_updated, sync_source)
                    SELECT s.id, $1, NOW(), 'sync'
                    FROM skus s 
                    WHERE s.clover_variant_id = $2
                    ON CONFLICT (sku_id)
                    DO UPDATE SET 
                        on_hand = EXCLUDED.on_hand,
                        last_updated = EXCLUDED.last_updated,
                        sync_source = EXCLUDED.sync_source
                `, [
                    invItem.quantity || 0,
                    invItem.item.id
                ]);
            }
            
            console.log('✅ Inventory sync complete');
        } catch (error) {
            console.error('❌ Inventory sync failed:', error);
            // Don't throw - inventory sync failure shouldn't break product sync
        }
    }
    
    // Get products for iPad display
    async getProductsForKiosk(search = '', categoryId = null) {
        const client = await db.connect();
        
        try {
            let query = `
                SELECT 
                    p.id as product_id,
                    p.name as product_name,
                    p.brand,
                    p.has_variants,
                    p.image_url,
                    s.id as sku_id,
                    s.sku,
                    s.upc,
                    s.name_suffix,
                    s.size,
                    s.flavor,
                    s.price_cents,
                    i.on_hand,
                    i.reserved,
                    CASE 
                        WHEN i.on_hand <= 0 THEN 'OUT_OF_STOCK'
                        WHEN i.on_hand <= i.reorder_level THEN 'LOW_STOCK' 
                        ELSE 'IN_STOCK'
                    END as stock_status
                FROM products p
                JOIN skus s ON s.product_id = p.id
                LEFT JOIN inventory i ON i.sku_id = s.id
                WHERE p.active = true 
                AND s.active = true 
                AND s.visible_in_kiosk = true
            `;
            
            const params = [];
            
            if (search) {
                query += ` AND (p.name ILIKE $${params.length + 1} OR p.brand ILIKE $${params.length + 1} OR s.sku ILIKE $${params.length + 1})`;
                params.push(`%${search}%`);
            }
            
            if (categoryId) {
                query += ` AND p.category_id = $${params.length + 1}`;
                params.push(categoryId);
            }
            
            query += ` ORDER BY p.name, s.name_suffix`;
            
            const result = await client.query(query, params);
            return result.rows;
            
        } finally {
            client.release();
        }
    }
}

module.exports = new ProductService();
