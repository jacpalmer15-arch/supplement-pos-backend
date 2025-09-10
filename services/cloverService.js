// services/cloverService.js
const axios = require('axios');

// Direct refs to your .env (easy to alter)
const {
  CLOVER_APP_ID,        // not needed for token-based calls, kept for future OAuth flows
  CLOVER_APP_SECRET,    // not needed for token-based calls, kept for future OAuth flows
  CLOVER_ENVIRONMENT,   // 'sandbox' | 'production'
  CLOVER_MERCHANT_ID,
  CLOVER_ACCESS_TOKEN,
  CLOVER_BASE_URL       // e.g. https://sandbox.dev.clover.com
} = process.env;

// Prefer explicit base URL; fall back by environment
const BASE_URL =
  (CLOVER_BASE_URL && CLOVER_BASE_URL.trim()) ||
  (CLOVER_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox.dev.clover.com'
    : 'https://api.clover.com');

function makeClient() {
  // Do NOT throw at import time—only when actually called
  if (!CLOVER_MERCHANT_ID || !CLOVER_ACCESS_TOKEN) {
    throw new Error('Missing CLOVER_MERCHANT_ID or CLOVER_ACCESS_TOKEN');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${CLOVER_ACCESS_TOKEN.trim()}`
      // NOTE: Clover App ID/Secret are for OAuth, not per-request headers
      // 'X-Clover-App-Id': CLOVER_APP_ID, // not required
    },
    timeout: 20000,
    validateStatus: s => s < 500
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWithRetry(path, params, { tries = 4, baseDelayMs = 300 } = {}) {
  const http = makeClient();
  let attempt = 0;
  for (;;) {
    const res = await http.get(path, { params });
    // Retry on 408/429/5xx
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      attempt++;
      if (attempt >= tries) {
        throw new Error(`Clover ${res.status} after ${tries} tries on ${path}: ${JSON.stringify(res.data)}`);
      }
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
      continue;
    }
    if (res.status >= 400) {
      throw new Error(`Clover ${res.status} on ${path}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }
}

/**
 * Fetch one Clover page (offset pagination).
 * Returns { items, nextOffset }.
 */
async function fetchCloverPage(path, { limit = 100, offset = 0, params = {} } = {}) {
  const data = await getWithRetry(path, { ...params, limit, offset });

  // Common Clover shapes
  const items = Array.isArray(data?.elements) ? data.elements
             : Array.isArray(data?.items)    ? data.items
             : Array.isArray(data)           ? data
             : [];

  const nextOffset = items.length < limit ? null : offset + items.length;
  return { items, nextOffset };
}

module.exports = {
  // expose env-driven values in case other modules need them
  CLOVER_APP_ID,
  CLOVER_APP_SECRET,
  CLOVER_ENVIRONMENT,
  CLOVER_MERCHANT_ID,
  CLOVER_ACCESS_TOKEN,
  CLOVER_BASE_URL: BASE_URL,

  makeClient,
  fetchCloverPage
};
