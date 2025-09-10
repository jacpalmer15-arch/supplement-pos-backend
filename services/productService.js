// services/productService.js
const db = require('../config/database');
const { getConfig, fetchCloverPage } = require('./cloverService');

class ProductService {
  /**
   * Pulls Clover items in pages and upserts into products/skus/inventory.
   * - No side effects at import time.
   * - Per-page transactions.
   * - Defaults to a small page budget to avoid serverless timeouts.
   */
  async syncAllProducts({ limit = 100, maxPages = 5 } = {}) {
    const client = await db.connect();
    let pagesProcessed = 0, totalProcessed = 0, inserted = 0, updated = 0;

    try {
      const { merchantId } = getConfig(); // throws here only if misconfigured
      let offset = 0;

      while (pagesProcessed < maxPages) {
        const { items, nextOffset } = await fetchCloverPage(
          `/v3/merchants/${merchantId}/items`,
          { limit, offset }
        );
        if (!items.length) break;

        await client.query('BEGIN');

        for (const it of items) {
          const cloverId  = it.id;
          const name      = (it.name || '').trim();
          const priceCents= Number.isFinite(it.price) ? it.price : null; // Clover price is cents
          const skuCode   = (it.code || '').trim(); // Clover "code" often ~= SKU
          const active    = it.hidden ? false : true;

          // Upsert product (conflict on external_id)
          const prod = await client.query(
            `
            INSERT INTO products (name, brand, has_variants, image_url, active, external_id, sync_source)
            VALUES ($1, NULL, false, NULL, $2, $3, 'clover')
            ON CONFLICT (external_id) DO UPDATE
              SET name = EXCLUDED.name,
                  active = EXCLUDED.active,
                  sync_source = 'clover'
            RETURNING id, (xmax = 0) AS inserted
            `,
            [name, active, cloverId]
          );
          const productId = prod.rows[0].id;
          if (prod.rows[0].inserted) inserted++; else updated++;

          // Upsert SKU (conflict on clover_item_id)
          await client.query(
            `
            INSERT INTO skus (
              product_id, sku, upc, name_suffix, size, flavor,
              price_cents, active, visible_in_kiosk, clover_item_id
            )
            VALUES ($1, NULLIF($2,''), NULL, NULL, NULL, NULL,
                    $3, $4, false, $5)
            ON CONFLICT (clover_item_id) DO UPDATE
              SET sku = COALESCE(NULLIF(EXCLUDED.sku,''), skus.sku),
                  price_cents = EXCLUDED.price_cents,
                  active = EXCLUDED.active
            `,
            [productId, skuCode, priceCents, active, cloverId]
          );

          // Ensure exactly one inventory row per SKU
          await client.query(
            `
            INSERT INTO inventory (sku_id, on_hand, reserved, reorder_level)
            SELECT s.id, COALESCE(i.on_hand,0), COALESCE(i.reserved,0), COALESCE(i.reorder_level,0)
            FROM skus s
            LEFT JOIN inventory i ON i.sku_id = s.id
            WHERE s.clover_item_id = $1
              AND i.sku_id IS NULL
            `,
            [cloverId]
          );
        }

        await client.query('COMMIT');

        pagesProcessed++;
        totalProcessed += items.length;
        if (nextOffset == null) break;
        offset = nextOffset;
      }

      return { ok: true, pagesProcessed, totalProcessed, inserted, updated, more: pagesProcessed === maxPages };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  // unchanged kiosk query
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
