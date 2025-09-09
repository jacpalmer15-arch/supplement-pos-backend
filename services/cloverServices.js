const axios = require('axios');

class CloverService {
    constructor() {
        this.baseURL = process.env.CLOVER_BASE_URL;
        this.merchantId = process.env.CLOVER_MERCHANT_ID;
        this.appId = process.env.CLOVER_APP_ID;
        this.appSecret = process.env.CLOVER_APP_SECRET;
        
        // For sandbox, we'll use basic auth initially
        // In production, you'd implement full OAuth flow
        this.apiKey = this.appSecret; // Simplified for testing
    }

    // Get authorization headers for Clover API calls
    getAuthHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    // Fetch all items from Clover
    async getItems() {
        try {
            const response = await axios.get(
                `${this.baseURL}/v3/merchants/${this.merchantId}/items`,
                { headers: this.getAuthHeaders() }
            );
            
            console.log(`📦 Fetched ${response.data.elements?.length || 0} items from Clover`);
            return response.data.elements || [];
        } catch (error) {
            console.error('❌ Error fetching items from Clover:', error.response?.data || error.message);
            throw new Error(`Failed to fetch items: ${error.message}`);
        }
    }

    // Fetch item variants (different sizes/flavors of same product)
    async getItemVariants(itemId) {
        try {
            const response = await axios.get(
                `${this.baseURL}/v3/merchants/${this.merchantId}/items/${itemId}?expand=variants`,
                { headers: this.getAuthHeaders() }
            );
            
            return response.data.variants?.elements || [];
        } catch (error) {
            console.error(`❌ Error fetching variants for item ${itemId}:`, error.message);
            return [];
        }
    }

    // Fetch inventory levels for all items
    async getInventory() {
        try {
            const response = await axios.get(
                `${this.baseURL}/v3/merchants/${this.merchantId}/item_stocks`,
                { headers: this.getAuthHeaders() }
            );
            
            console.log(`📊 Fetched inventory for ${response.data.elements?.length || 0} items`);
            return response.data.elements || [];
        } catch (error) {
            console.error('❌ Error fetching inventory from Clover:', error.message);
            throw new Error(`Failed to fetch inventory: ${error.message}`);
        }
    }

    // Create order in Clover (for checkout)
    async createOrder(orderData) {
        try {
            const response = await axios.post(
                `${this.baseURL}/v3/merchants/${this.merchantId}/orders`,
                orderData,
                { headers: this.getAuthHeaders() }
            );
            
            return response.data;
        } catch (error) {
            console.error('❌ Error creating order in Clover:', error.response?.data || error.message);
            throw new Error(`Failed to create order: ${error.message}`);
        }
    }

    // Initiate payment on Clover Mini
    async initiatePayment(orderId, amount, externalId) {
        try {
            const response = await axios.post(
                `${this.baseURL}/v3/merchants/${this.merchantId}/pay/sale`,
                {
                    orderId: orderId,
                    amount: amount,
                    externalId: externalId,
                    tipAmount: 0,
                    taxAmount: 0
                },
                { headers: this.getAuthHeaders() }
            );
            
            return response.data;
        } catch (error) {
            console.error('❌ Error initiating payment:', error.response?.data || error.message);
            throw new Error(`Failed to initiate payment: ${error.message}`);
        }
    }
}

module.exports = new CloverService();
