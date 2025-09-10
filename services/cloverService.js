// services/cloverService.js
const axios = require('axios');

const CLOVER_BASE = 'https://api.clover.com';

function getConfig() {
  const merchantId = (process.env.CLOVER_MERCHANT_ID || '').trim();
  const token = (process.env.CLOVER_ACCESS_TOKEN || '').trim();
  if (!merchantId || !token) {
    // Throw only when a caller actually uses Clover (no import-time crash)
    throw new Error('Clover config missing: set CLOVER_MERCHANT_ID and CLOVER_ACCESS_TOKEN');
  }
  return { merchantId, token };
}

function cloverClient(token) {
  return axios.create({
    baseURL: CLOVER_BASE,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
    validateStatus: s => s < 500
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function requestWithRetry(http, path, params, { tries = 4, baseMs = 300 } = {}) {
  let attempt = 0;
  for (;;) {
    const res = await http.get(path, { params });
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      attempt++;
      if (attempt >= tries) {
        throw new Error(`Clover ${res.status} after ${tries} tries on ${path}: ${JSON.stringify(res.data)}`);
      }
      await delay(baseMs * Math.pow(2, attempt - 1));
      continue;
    }
    if (res.status >= 400) {
      throw new Error(`Clover ${res.status} on ${path}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }
}

/** Fetch one page; returns { items, nextOffset } */
async function fetchCloverPage(path, { params = {}, limit = 100, offset = 0 } = {}) {
  const { token } = getConfig();
  const http = cloverClient(token);
  const data = await requestWithRetry(http, path, { ...params, limit, offset });

  const items = Array.isArray(data?.elements) ? data.elements
              : Array.isArray(data?.items)    ? data.items
              : Array.isArray(data)           ? data
              : [];

  const nextOffset = items.length < limit ? null : offset + items.length;
  return { items, nextOffset };
}

module.exports = { getConfig, fetchCloverPage };
