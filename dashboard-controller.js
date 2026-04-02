/**
 * LIVE DATA CONTROLLER
 * Handles API polling and UI updates for Geopolitical impacts
 */

const DashboardLive = {
    // Configuration
    config: {
        endpoint: '/api/market', // Points to your serverless function
        refreshRate: 30000,      // 30 seconds (staying within free tier limits)
        activeSymbol: 'SPY'      // Default (S&P 500)
    },

    init() {
        console.log("Dashboard Live Feed Initialized...");
        this.fetchData();
        this.startPolling();
    },

    async fetchData() {
        try {
            const response = await fetch(`${this.config.endpoint}?symbol=${this.config.activeSymbol}`);
            const data = await response.json();
            
            this.updatePriceUI(data);
            this.updateGeopoliticalNews(data.news);
        } catch (error) {
            console.error("Data Fetch Error:", error);
        }
    },

    updatePriceUI(data) {
        // Target specific IDs in your index_v2.html
        const priceEl = document.getElementById('live-price');
        const changeEl = document.getElementById('live-change');

        if (priceEl) priceEl.innerText = `$${data.price.toFixed(2)}`;
        
        if (changeEl) {
            const sign = data.change >= 0 ? '+' : '';
            changeEl.innerText = `${sign}${data.change.toFixed(2)} (${data.percentChange.toFixed(2)}%)`;
            changeEl.style.color = data.change >= 0 ? '#00e676' : '#ff3d4a';
        }
    },

    updateGeopoliticalNews(newsItems) {
        const feedContainer = document.getElementById('geopolitical-feed');
        if (!feedContainer) return;

        feedContainer.innerHTML = newsItems.map(item => `
            <div class="news-item" style="border-bottom: 1px solid var(--border-dim); padding: 10px 0;">
                <small style="color: var(--cyan); font-family: var(--mono);">${new Date(item.datetime * 1000).toLocaleTimeString()}</small>
                <h4 style="margin: 5px 0; font-size: 0.85rem;">${item.headline}</h4>
                <p style="font-size: 0.7rem; color: var(--text-dim);">${item.summary.substring(0, 80)}...</p>
            </div>
        `).join('');
    },

    startPolling() {
        setInterval(() => this.fetchData(), this.config.refreshRate);
    }
};

// Start the dashboard
document.addEventListener('DOMContentLoaded', () => DashboardLive.init());
