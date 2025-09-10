// services/cloverService.js
const axios = require('axios');

class CloverService {
  constructor() {
    this.baseURL = process.env.CLOVER_BASE_URL;           // e.g. https://sandbox.dev.clover.com
    this.merchantId = process.env.CLOVER_MERCHANT_ID;     // e.g. RCTST...
    this.accessToken = process.env.CLOVER_ACCESS_TOKEN;   // <-- NEW: real merchant access token

    if (!this.baseURL || !this.merchantId || !this.accessToken) {
      throw new Error('Clover config missing: CLOVER_BASE_URL, CLOVER_MERCHANT_ID, or CLOVER_ACCESS_TOKEN');
    }
  }

  getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async getItems() {
    try {
      const url = `${this.baseURL}/v3/merchants/${this.merchantId}/items`;
      const res = await axios.get(url, { headers: this.getAuthHeaders() });
      return res.data.elements || [];
    } catch (err) {
      const data = err.response?.data || err.message;
      console.error('Error fetching items from Clover:', data);
      throw new Error(`Failed to fetch items: ${err.response?.status} ${JSON.stringify(data)}`);
    }
  }

  async getItemVariants(itemId) {
    try {
      const url = `${this.baseURL}/v3/merchants/${this.merchantId}/items/${itemId}?expand=variants`;
      const res = await axios.get(url, { headers: this.getAuthHeaders() });
      return res.data.variants?.elements || [];
    } catch (err) {
      console.error(`Error fetching variants for item ${itemId}:`, err.response?.data || err.message);
      return [];
    }
  }

  async getInventory() {
    try {
      const url = `${this.baseURL}/v3/merchants/${this.merchantId}/item_stocks`;
      const res = await axios.get(url, { headers: this.getAuthHeaders() });
      return res.data.elements || [];
    } catch (err) {
      const data = err.response?.data || err.message;
      console.error('Error fetching inventory from Clover:', data);
      throw new Error(`Failed to fetch inventory: ${err.response?.status} ${JSON.stringify(data)}`);
    }
  }

  async createOrder(orderData) {
    try {
      const url = `${this.baseURL}/v3/merchants/${this.merchantId}/orders`;
      const res = await axios.post(url, orderData, { headers: this.getAuthHeaders() });
      return res.data;
    } catch (err) {
      const data = err.response?.data || err.message;
      console.error('Error creating order in Clover:', data);
      throw new Error(`Failed to create order: ${err.response?.status} ${JSON.stringify(data)}`);
    }
  }

  async initiatePayment(orderId, amount, externalId) {
    try {
      const url = `${this.baseURL}/v3/merchants/${this.merchantId}/pay/sale`;
      const payload = { orderId, amount, externalId, tipAmount: 0, taxAmount: 0 };
      const res = await axios.post(url, payload, { headers: this.getAuthHeaders() });
      return res.data;
    } catch (err) {
      const data = err.response?.data || err.message;
      console.error('Error initiating payment:', data);
      throw new Error(`Failed to initiate payment: ${err.response?.status} ${JSON.stringify(data)}`);
    }
  }
}

module.exports = new CloverService();
