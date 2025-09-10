// services/cloverService.js
const axios = require('axios');

const CLOVER_BASE = 'https://api.clover.com';
const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;
const ACCESS_TOKEN = process.env.CLOVER_ACCESS_TOKEN;

function cloverClient() {
  if (!MERCHANT_ID) throw new Error('CLOVER_MERCHANT_ID not set');
  if (!ACCESS_TOKEN) throw new Error('CLOVER_ACCESS_TOKEN not set');

  const http = axios.create({
    baseURL: CLOVER_BASE,
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    timeout: 20000,
    validateStatus: s => s < 500
  });

  http.interceptors.response.use(
    r => r,
    e => Promise.reject(e)
  );

  return http;
}

/**
 * Offset-based paginator for Clover endpoints that accept limit/offset.
 * Yields arrays of elements until exhausted.
 */
async function* paginateOffset(path, params = {}, pageSize = 100) {
  const http = cloverClient();
  let offset = 0;

  for (;;) {
    const res = await http.get(path, { params: { ...params, limit: pageSize, offset } });
    if (res.status >= 400) {
      throw new Error(`Clover ${res.status} on ${path}: ${JSON.stringify(res.data)}`);
    }

    // Clover commonly returns {elements:[...], href:"..."}; fall back if structure differs
    const batch = Array.isArray(res.data?.elements) ? res.data.elements
                : Array.isArray(res.data) ? res.data
                : Array.isArray(res.data?.items) ? res.data.items
                : [];

    if (!batch.length) break;

    yield batch;

    // last page if we got fewer than pageSize
    if (batch.length < pageSize) break;
    offset += batch.length;
  }
}

module.exports = { paginateOffset, MERCHANT_ID };

// services/productService.js
const db = require('../config/database');
const { paginateOffset, MERCHANT_ID } = require('./cloverService');

class ProductService {
  /**
   * Fetch all Clover items in pages and upsert into products/skus/inventory.
   * Idempotent: safe to run repeatedly.
   */
  async syncAllProducts() {
    const client = await db.connect();
    let total = 0, inserted = 0, updated = 0;

    try {
      // Optional: ensure unique keys exist to make UPSERTs deterministic
      // await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_skus_clover ON skus(clover_item_id)`);

      for await (const items of paginateOffset(
        `/v3/merchants/${MERCHANT_ID}/items`,
        {
          // Add fields you care about. Expand what you need (varies by plan):
          // expand: 'categories,tags'  // uncomment if your plan supports expand
        },
        100
      )) {
        await client.query('BEGIN');

        for (const it of items) {
          // Map Clover item → your schema
          const cloverId = it.id;
          const name = (it.name || '').trim();
          const priceCents = Number.isFinite(it.price) ? it.price : null; // Clover price is in cents
          const skuCode = (it.code || '').trim(); // Clover "code" is often used as SKU
          const active = it.hidden ? false : true;

          // 1) Upsert product (one row per logical product; adjust mapping as needed)
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

          // 2) Upsert sku (treat each Clover item as a sellable SKU)
          await client.query(
            `
            INSERT INTO skus (product_id, sku, upc, name_suffix, size, flavor, price_cents, active, visible_in_kiosk, clover_item_id)
            VALUES ($1, NULLIF($2,''), NULL, NULL, NULL, NULL, $3, $4, COALESCE(visible_in_kiosk, false), $5)
            ON CONFLICT (clover_item_id) DO UPDATE
              SET sku = COALESCE(NULLIF(EXCLUDED.sku,''), skus.sku),
                  price_cents = EXCLUDED.price_cents,
                  active = EXCLUDED.active
            `,
            [productId, skuCode, priceCents, active, cloverId]
          );

          // 3) Ensure inventory row exists for the sku (one row per sku_id)
          await client.query(
            `
            INSERT INTO inventory (sku_id, on_hand, reserved, reorder_level)
            SELECT s.id, COALESCE(i.on_hand,0), COALESCE(i.reserved,0), COALESCE(i.reorder_level, 0)
            FROM skus s
            LEFT JOIN inventory i ON i.sku_id = s.id
            WHERE s.clover_item_id = $1
              AND i.sku_id IS NULL
            `,
            [cloverId]
          );
        }

        await client.query('COMMIT');
        total += items.length;
      }

      return { total, inserted, updated };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  // unchanged
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

