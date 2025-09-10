// services/productService.js
const db = require('../config/database');
const axios = require('axios');

const {
  CLOVER_BASE_URL,
  CLOVER_ENVIRONMENT,
  CLOVER_ACCESS_TOKEN,
  CLOVER_MERCHANT_ID
} = process.env;

// Resolve base URL from env (sandbox vs prod), prefer explicit BASE_URL
const BASE_URL =
  (CLOVER_BASE_URL && CLOVER_BASE_URL.trim()) ||
  (CLOVER_ENVIRONMENT === 'sandbox'
    ? 'https://apisandbox.dev.clover.com'
    : 'https://api.clover.com');

function clover() {
  if (!CLOVER_ACCESS_TOKEN || !CLOVER_MERCHANT_ID) {
    throw new Error('Missing CLOVER_ACCESS_TOKEN or CLOVER_MERCHANT_ID');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${CLOVER_ACCESS_TOKEN.trim()}` },
    timeout: 20000,
    validateStatus: s => s < 500,
  });
}

async function fetchPaged(path, { params = {}, limit = 100 } = {}, onBatch) {
  const http = clover();
  let offset = 0;
  for (;;) {
    const res = await http.get(path, { params: { ...params, limit, offset } });
    if (res.status >= 400) throw new Error(`${res.status} ${path}: ${JSON.stringify(res.data)}`);

    const data = res.data || {};
    const items = Array.isArray(data.elements) ? data.elements
                : Array.isArray(data.items)    ? data.items
                : Array.isArray(data)           ? data
                : [];

    if (!items.length) break;
    await onBatch(items);
    if (items.length < limit) break;
    offset += items.length;
  }
}

class ProductService {
  /**
   * Full backfill every call:
   * - Categories → Item Groups → Items (with categories) → Item Stocks
   * - Idempotent upserts; per-page transactions
   */
  async syncAllProducts({ limit = 100 } = {}) {
    if (!CLOVER_MERCHANT_ID) throw new Error('CLOVER_MERCHANT_ID not set');

    const http = clover();
    const client = await db.connect();

    // 0) Ensure a merchant row exists (required by FKs)
    const merchantId = await this.#ensureMerchant(client, CLOVER_MERCHANT_ID);

    // 1) Categories
    const categoryIdByClover = new Map();
    await fetchPaged(`/v3/merchants/${CLOVER_MERCHANT_ID}/categories`, { limit }, async (cats) => {
      await client.query('BEGIN');
      try {
        for (const c of cats) {
          const id = await this.#upsertCategory(client, {
            merchantId,
            cloverCategoryId: c.id,
            name: c.name || 'Uncategorized',
            sortOrder: Number.isFinite(c.sortOrder) ? c.sortOrder : 0,
            active: true,
          });
          categoryIdByClover.set(c.id, id);
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    });

    // 2) Item Groups → create/ensure parent products with has_variants = true
    const productIdByGroup = new Map();
    await fetchPaged(`/v3/merchants/${CLOVER_MERCHANT_ID}/item_groups`, { limit }, async (groups) => {
      await client.query('BEGIN');
      try {
        for (const g of groups) {
          const { productId } = await this.#upsertProduct(client, {
            merchantId,
            cloverItemId: g.id,          // group id
            name: g.name || 'Unnamed Group',
            hasVariants: true,
            basePriceCents: null,
            categoryId: null,
            active: true,
          });
          productIdByGroup.set(g.id, productId);
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    });

    // Helpers to aggregate a base price per product (min of its SKUs)
    const minPriceByProduct = new Map();

    // 3) Items (variants + singletons) — expand categories & itemGroup for mapping
    await fetchPaged(
      `/v3/merchants/${CLOVER_MERCHANT_ID}/items`,
      { limit, params: { expand: 'categories,itemGroup' } },
      async (items) => {
        await client.query('BEGIN');
        try {
          for (const it of items) {
            const cloverItemId = it.id;
            const name = (it.name || '').trim();
            const priceCents = Number.isFinite(it.price) ? it.price : null; // cents
            const skuCode = (it.code || '').trim(); // Clover SKU is `code`
            const active = it.hidden ? false : true;

            // Determine parent product: group parent if present, else singleton product
            const groupId = it.itemGroup?.id || null;
            let productId = null;

            if (groupId) {
              // existing group product or create it if group page hasn’t loaded one (safety)
              if (!productIdByGroup.has(groupId)) {
                const { productId: pid } = await this.#upsertProduct(client, {
                  merchantId,
                  cloverItemId: groupId,
                  name: name || 'Unnamed Group',
                  hasVariants: true,
                  basePriceCents: null,
                  categoryId: null,
                  active: true,
                });
                productIdByGroup.set(groupId, pid);
              }
              productId = productIdByGroup.get(groupId);
            } else {
              // singleton: product row keyed by the item id itself
              const { productId: pid } = await this.#upsertProduct(client, {
                merchantId,
                cloverItemId: cloverItemId,  // singleton uses its own item id
                name,
                hasVariants: false,
                basePriceCents: priceCents,
                categoryId: null,
                active,
              });
              productId = pid;
            }

            // Choose a primary category (first, if expanded present)
            let chosenCategoryId = null;
            const cats = it.categories?.elements || [];
            if (cats.length) {
              const first = cats[0];
              chosenCategoryId = categoryIdByClover.get(first.id) || null;
            }
            if (chosenCategoryId) {
              await client.query(
                `UPDATE products SET category_id = $1 WHERE id = $2 AND (category_id IS DISTINCT FROM $1)`,
                [chosenCategoryId, productId]
              );
            }

            // Upsert SKU for this Clover item
            const { rows: skuRows } = await client.query(
              `
              INSERT INTO skus (
                product_id, clover_variant_id, sku, upc, name_suffix, size, flavor,
                price_cents, cost_cents, is_individual, visible_in_kiosk, active
              )
              VALUES ($1, $2, NULLIF($3,''), NULL, NULL, NULL, NULL,
                      $4, NULL, $5, DEFAULT, $6)
              ON CONFLICT (clover_variant_id) DO UPDATE
                SET product_id  = EXCLUDED.product_id,
                    sku         = COALESCE(NULLIF(EXCLUDED.sku,''), skus.sku),
                    price_cents = EXCLUDED.price_cents,
                    active      = EXCLUDED.active,
                    updated_at  = NOW()
              RETURNING id
              `,
              [productId, cloverItemId, skuCode, priceCents, groupId ? false : true, active]
            );
            const skuId = skuRows[0].id;

            // Track min price per product to set products.base_price_cents
            if (Number.isFinite(priceCents)) {
              const prev = minPriceByProduct.get(productId);
              minPriceByProduct.set(productId, prev == null ? priceCents : Math.min(prev, priceCents));
            }

            // Ensure inventory row exists (will be updated in step 4)
            await client.query(
              `
              INSERT INTO inventory (sku_id, on_hand, reserved, reorder_level, sync_source, last_updated)
              VALUES ($1, COALESCE(NULL,0), COALESCE(NULL,0), COALESCE(NULL,5), 'sync', NOW())
              ON CONFLICT (sku_id) DO NOTHING
              `,
              [skuId]
            );
          }

          // Apply base price mins gathered this page
          for (const [pid, minPrice] of minPriceByProduct.entries()) {
            await client.query(
              `UPDATE products
                 SET base_price_cents = CASE
                     WHEN base_price_cents IS NULL THEN $2
                     ELSE LEAST(base_price_cents, $2)
                   END,
                     updated_at = NOW()
               WHERE id = $1`,
              [pid, minPrice]
            );
          }

          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
      }
    );

    // 4) Item stock → update inventory.on_hand by Clover item id (→ SKU)
    await fetchPaged(
      `/v3/merchants/${CLOVER_MERCHANT_ID}/item_stocks`,
      { limit },
      async (stocks) => {
        await client.query('BEGIN');
        try {
          for (const s of stocks) {
            const itemId = s.item?.id; // Clover item id
            if (!itemId) continue;
            const qty = Number.isFinite(s.quantity) ? Math.round(s.quantity) : 0;

            // Find our sku by clover_variant_id
            const { rows: sku } = await client.query(
              `SELECT id FROM skus WHERE clover_variant_id = $1 LIMIT 1`,
              [itemId]
            );
            if (!sku.length) continue;

            await client.query(
              `
              INSERT INTO inventory (sku_id, on_hand, reserved, reorder_level, sync_source, last_updated)
              VALUES ($1, $2, 0, 5, 'sync', NOW())
              ON CONFLICT (sku_id) DO UPDATE
                SET on_hand = EXCLUDED.on_hand,
                    last_updated = NOW(),
                    sync_source = 'sync'
              `,
              [sku[0].id, qty]
            );
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
      }
    );

    client.release();
    return { ok: true };
  }

  // ---------- helpers (private) ----------

  async #ensureMerchant(client, cloverMerchantId) {
    // Try to find existing merchant
    const found = await client.query(
      `SELECT id FROM merchants WHERE clover_merchant_id = $1 LIMIT 1`,
      [cloverMerchantId]
    );
    if (found.rowCount) return found.rows[0].id;

    // Create a placeholder (business_name required)
    const { data } = await clover().get(`/v3/merchants/${cloverMerchantId}`);
    const businessName = (data && (data.name || data.merchantName)) || 'Clover Merchant';

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

  async #upsertCategory(client, { merchantId, cloverCategoryId, name, sortOrder, active }) {
    // Manual upsert (no unique constraint on clover_category_id)
    const sel = await client.query(
      `SELECT id FROM categories WHERE clover_category_id = $1 LIMIT 1`,
      [cloverCategoryId]
    );
    if (sel.rowCount) {
      const id = sel.rows[0].id;
      await client.query(
        `UPDATE categories
           SET name = $2, sort_order = $3, active = $4
         WHERE id = $1`,
        [id, name, sortOrder, active]
      );
      return id;
    } else {
      const ins = await client.query(
        `
        INSERT INTO categories (merchant_id, clover_category_id, name, sort_order, active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [merchantId, cloverCategoryId, name, sortOrder, active]
      );
      return ins.rows[0].id;
    }
  }

  async #upsertProduct(client, {
    merchantId, cloverItemId, name, hasVariants, basePriceCents, categoryId, active
  }) {
    const r = await client.query(
      `
      INSERT INTO products (
        merchant_id, clover_item_id, category_id, name, brand, description,
        image_url, has_variants, base_price_cents, active
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $7)
      ON CONFLICT (clover_item_id) DO UPDATE
        SET name = EXCLUDED.name,
            has_variants = EXCLUDED.has_variants,
            active = EXCLUDED.active,
            updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
      `,
      [merchantId, cloverItemId, categoryId, name, hasVariants, basePriceCents, active]
    );
    return { productId: r.rows[0].id, inserted: r.rows[0].inserted };
  }

  // ---- existing kiosk query (unchanged) ----
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
