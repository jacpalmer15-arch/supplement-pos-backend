// services/productService.js
const db = require('../config/database');
const { clover, fetchPaged, CLOVER_MERCHANT_ID } = require('./cloverService');

class ProductService {
  /**
   * Full backfill every call (idempotent):
   * 1) Ensure merchants row
   * 2) Categories -> upsert
   * 3) Items (each Clover Item -> one products row) -> upsert
   * 4) Item stocks -> inventory upsert (1:1 with product)
   */
  async syncAllProducts({ limit = 100 } = {}) {
    if (!CLOVER_MERCHANT_ID) throw new Error('CLOVER_MERCHANT_ID not set');

    const http = clover();
    const client = await db.connect();

    // 0) Ensure merchant exists (by clover_merchant_id)
    const merchantId = await this.#ensureMerchant(client, http, CLOVER_MERCHANT_ID);

    // 1) Categories
    let categoriesUpserted = 0;
    await fetchPaged(
      `/v3/merchants/${CLOVER_MERCHANT_ID}/categories`,
      { limit },
      async (cats) => {
        await client.query('BEGIN');
        try {
          for (const c of cats) {
            const name = (c.name || 'Uncategorized').trim();
            const sortOrder = Number.isFinite(c.sortOrder) ? c.sortOrder : 0;
            const r = await client.query(
              `
              INSERT INTO categories (merchant_id, clover_category_id, name, sort_order, active)
              VALUES ($1, $2, $3, $4, true)
              ON CONFLICT (merchant_id, clover_category_id) DO UPDATE
                SET name = EXCLUDED.name,
                    sort_order = EXCLUDED.sort_order,
                    active = true,
                    updated_at = NOW()
              RETURNING (xmax = 0) AS inserted
              `,
              [merchantId, c.id, name, sortOrder]
            );
            if (r.rows[0].inserted) categoriesUpserted++;
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
      }
    );

    // Helper: cache of category Clover ID -> categories.id
    const categoryIdByClover = await this.#loadCategoryMap(client, merchantId);

    // 2) Items -> products (expand categories + itemGroup to decide mapping)
    let productsInserted = 0;
    let productsUpdated = 0;

    await fetchPaged(
      `/v3/merchants/${CLOVER_MERCHANT_ID}/items`,
      { limit, params: { expand: 'categories,itemGroup' } },
      async (items) => {
        await client.query('BEGIN');
        try {
          for (const it of items) {
            const cloverItemId = it.id;
            const itemGroupId = it.itemGroup?.id || null;

            const name = (it.name || '').trim();
            const sku  = (it.code || '').trim() || null; // nullable by design
            const priceCents = Number.isFinite(it.price) ? it.price : 0; // Clover price is in cents
            const active = it.hidden ? false : true;

            // Choose a primary category (first if present)
            let categoryId = null;
            const cats = it.categories?.elements || [];
            if (cats.length) {
              categoryId = categoryIdByClover.get(cats[0].id) || null;
            }

            const r = await client.query(
              `
              INSERT INTO products (
                merchant_id, clover_item_id, item_group_id, category_id,
                name, brand, description, image_url,
                sku, upc, name_suffix, size, flavor,
                price_cents, cost_cents, tax_rate_decimal,
                visible_in_kiosk, active
              )
              VALUES ($1, $2, $3, $4,
                      $5, NULL, NULL, NULL,
                      $6, NULL, NULL, NULL, NULL,
                      $7, NULL, DEFAULT,
                      DEFAULT, $8)
              ON CONFLICT (merchant_id, clover_item_id) DO UPDATE
                SET name          = EXCLUDED.name,
                    item_group_id = EXCLUDED.item_group_id,
                    category_id   = EXCLUDED.category_id,
                    -- keep existing non-null SKU if Clover sends null/blank
                    sku           = COALESCE(NULLIF(EXCLUDED.sku, ''), products.sku),
                    price_cents   = EXCLUDED.price_cents,
                    active        = EXCLUDED.active,
                    updated_at    = NOW()
              RETURNING id, (xmax = 0) AS inserted
              `,
              [
                merchantId,
                cloverItemId,
                itemGroupId,
                categoryId,
                name,
                sku,
                priceCents,
                active,
              ]
            );

            if (r.rows[0].inserted) productsInserted++; else productsUpdated++;
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
      }
    );

    // 3) Item stocks -> inventory (1:1 with product)
    let inventoryUpserted = 0;

    await fetchPaged(
      `/v3/merchants/${CLOVER_MERCHANT_ID}/item_stocks`,
      { limit },
      async (stocks) => {
        await client.query('BEGIN');
        try {
          for (const s of stocks) {
            const itemId = s.item?.id;
            if (!itemId) continue;

            const qty = Number.isFinite(s.quantity) ? Math.trunc(s.quantity) : 0;

            // Resolve product by Clover item id
            const pr = await client.query(
              `SELECT id FROM products WHERE merchant_id = $1 AND clover_item_id = $2 LIMIT 1`,
              [merchantId, itemId]
            );
            if (!pr.rowCount) continue; // product not yet created (rare if items step succeeded)

            const productId = pr.rows[0].id;

            const ir = await client.query(
              `
              INSERT INTO inventory (product_id, on_hand, reserved, reorder_level, max_stock, last_counted_at, last_updated, sync_source)
              VALUES ($1, $2, 0, 5, NULL, NULL, NOW(), 'sync')
              ON CONFLICT (product_id) DO UPDATE
                SET on_hand     = EXCLUDED.on_hand,
                    last_updated = NOW(),
                    sync_source  = 'sync'
              RETURNING (xmax = 0) AS inserted
              `,
              [productId, qty]
            );
            if (ir.rows[0].inserted) inventoryUpserted++;
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
      }
    );

    client.release();
    return {
      success: true,
      merchantId,
      counts: {
        categoriesUpserted,
        productsInserted,
        productsUpdated,
        inventoryUpserted,
      },
    };
  }

  // ----------------- Reads -----------------

  /**
   * Kiosk feed:
   * - Only active + visible products
   * - Optional search (name/brand/sku/upc)
   * - Optional category filter
   * - Stock status derived from inventory
   */
  async getProductsForKiosk({ search = '', categoryId = null } = {}) {
    const client = await db.connect();
    try {
      const params = [];
      let where = `p.active = true AND p.visible_in_kiosk = true`;

      if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        where += ` AND (
          p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.upc ILIKE $${idx}
        )`;
      }
      if (categoryId) {
        params.push(categoryId);
        where += ` AND p.category_id = $${params.length}`;
      }

      const sql = `
        SELECT
          p.id                AS product_id,
          p.clover_item_id,
          p.item_group_id,
          p.name,
          p.brand,
          p.description,
          p.image_url,
          p.sku,
          p.upc,
          p.name_suffix,
          p.size,
          p.flavor,
          p.price_cents,
          COALESCE(i.on_hand, 0) AS on_hand,
          COALESCE(i.reserved, 0) AS reserved,
          CASE
            WHEN COALESCE(i.on_hand,0) <= 0 THEN 'OUT_OF_STOCK'
            WHEN COALESCE(i.on_hand,0) <= COALESCE(i.reorder_level,5) THEN 'LOW_STOCK'
            ELSE 'IN_STOCK'
          END AS stock_status
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE ${where}
        ORDER BY p.name, p.name_suffix NULLS LAST
      `;

      const { rows } = await client.query(sql, params);
      return rows;
    } finally {
      client.release();
    }
  }

  // --------------- private helpers ---------------

  async #ensureMerchant(client, http, cloverMerchantId) {
    // Try to find existing merchant row
    const found = await client.query(
      `SELECT id FROM merchants WHERE clover_merchant_id = $1 LIMIT 1`,
      [cloverMerchantId]
    );
    if (found.rowCount) return found.rows[0].id;

    // Fetch name from Clover for a nicer default
    let businessName = 'Clover Merchant';
    try {
      const r = await http.get(`/v3/merchants/${cloverMerchantId}`);
      businessName = (r.data?.name || r.data?.merchantName || businessName).toString();
    } catch (_) { /* keep default */ }

    const ins = await client.query(
      `
      INSERT INTO merchants (clover_merchant_id, business_name, active)
      VALUES ($1, $2, true)
      RETURNING id
      `,
      [cloverMerchantId, businessName]
    );
    return ins.rows[0].id;
  }

  async #loadCategoryMap(client, merchantId) {
    const m = new Map();
    const { rows } = await client.query(
      `SELECT id, clover_category_id FROM categories WHERE merchant_id = $1`,
      [merchantId]
    );
    for (const r of rows) if (r.clover_category_id) m.set(r.clover_category_id, r.id);
    return m;
  }
}

module.exports = new ProductService();
