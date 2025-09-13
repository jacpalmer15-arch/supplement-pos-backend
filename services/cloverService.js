// services/cloverService.js
const axios = require('axios');

const {
  CLOVER_ENVIRONMENT,
  CLOVER_BASE_URL,
  CLOVER_ACCESS_TOKEN,
  CLOVER_MERCHANT_ID,
} = process.env;

// Prefer explicit base URL; otherwise infer from environment.
const BASE_URL =
  (CLOVER_BASE_URL && CLOVER_BASE_URL.trim()) ||
  (String(CLOVER_ENVIRONMENT).toLowerCase() === 'sandbox'
    ? 'https://sandbox.dev.clover.com'
    : 'https://api.clover.com');

function clover() {
  if (!CLOVER_ACCESS_TOKEN || !CLOVER_MERCHANT_ID) {
    throw new Error('Missing CLOVER_ACCESS_TOKEN or CLOVER_MERCHANT_ID');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${CLOVER_ACCESS_TOKEN.trim()}` },
    timeout: 20000,
    validateStatus: s => s < 500, // surface 4xx, retry 5xx upstream if you add retries
  });
}

/**
 * Page through Clover collections with limit/offset using a specific client.
 * onBatch receives each page (array). Stops when a short page is seen.
 * @param {string} path - API path to fetch
 * @param {Object} options - Options including params and limit
 * @param {Function} onBatch - Callback function to process each batch
 * @param {Object} httpClient - Optional axios client to use (defaults to global clover client)
 */
async function fetchPaged(path, { params = {}, limit = 100 } = {}, onBatch, httpClient = null) {
  const http = httpClient || clover();
  let offset = 0;

  for (;;) {
    const res = await http.get(path, { params: { ...params, limit, offset } });
    if (res.status >= 400) {
      throw new Error(`${res.status} ${path}: ${JSON.stringify(res.data)}`);
    }

    const data = res.data || {};
    const page =
      Array.isArray(data.elements) ? data.elements :
      Array.isArray(data.items)    ? data.items :
      Array.isArray(data)          ? data :
      [];

    if (!page.length) break;
    // user callback does the DB work
    // eslint-disable-next-line no-await-in-loop
    await onBatch(page);

    if (page.length < limit) break;
    offset += page.length;
  }
}

module.exports = {
  clover,
  fetchPaged,
  CLOVER_MERCHANT_ID,
};
