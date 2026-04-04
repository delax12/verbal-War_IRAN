/**
 * LIVE DATA CONTROLLER — dashboard-live.js
 * ─────────────────────────────────────────
 * Handles API polling and WebSocket streaming for live market prices
 * and geopolitical news feed.
 *
 * STATUS: PAUSED — auto-init disabled pending /api/market.js + Finnhub key setup.
 * DO NOT DELETE. This will be fully wired in Step 3.
 *
 * INTEGRATION PLAN:
 *   Step 3a → /api/market.js (Finnhub proxy) deployed to Vercel
 *   Step 3b → FINNHUB_API_KEY added to Vercel Environment Variables
 *   Step 3c → DashboardLive.init() called from index.html DOMContentLoaded
 *   Step 3d → Finnhub WebSocket replaces polling for real-time equity prices
 *
 * FINNHUB FREE TIER LIMITS:
 *   REST:      60 API calls/minute
 *   WebSocket: Real-time trades, US stocks, no delay
 *   News:      Company news, general news, last 7 days
 *   Get key:   https://finnhub.io/register (free, instant)
 */

const DashboardLive = {

  /* ── Configuration ── */
  config: {
    endpoint:    '/api/market',  // Vercel serverless proxy → see /api/market.js
    wsEndpoint:  'wss://ws.finnhub.io', // WebSocket for real-time prices
    refreshRate: 30000,          // 30 sec REST polling fallback (free tier safe)
    activeSymbol:'SPY',          // Default symbol — overridden by setSymbol()

    // Symbols shown in the ticker strip — maps to existing tickerData in index.html
    watchlist: ['XOM', 'LMT', 'RTX', 'DAL', 'GLD', 'SPY'],
  },

  // Internal state
  _pollingTimer: null,
  _ws:           null,
  _wsConnected:  false,

  /* ─────────────────────────────────────────────
     INIT — called from index.html DOMContentLoaded
     Will be enabled in Step 3.
  ───────────────────────────────────────────── */
  init() {
    console.log('[DashboardLive] Initializing…');
    this.fetchData();          // immediate first load
    this.startPolling();       // REST fallback every 30s
    this.connectWebSocket();   // real-time WebSocket (Finnhub)
  },

  /* ─────────────────────────────────────────────
     REST POLLING — fallback when WebSocket is down
  ───────────────────────────────────────────── */
  async fetchData() {
    try {
      const res = await fetch(
        `${this.config.endpoint}?symbol=${this.config.activeSymbol}`
      );

      if (!res.ok) throw new Error(`/api/market returned ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      this.updatePriceUI(data);
      if (data.news && data.news.length) {
        this.updateGeopoliticalNews(data.news);
      }

    } catch (err) {
      console.warn('[DashboardLive] fetchData error:', err.message);
    }
  },

  startPolling() {
    clearInterval(this._pollingTimer);
    this._pollingTimer = setInterval(
      () => this.fetchData(),
      this.config.refreshRate
    );
  },

  stopPolling() {
    clearInterval(this._pollingTimer);
    this._pollingTimer = null;
  },

  /* ─────────────────────────────────────────────
     WEBSOCKET — Finnhub real-time trade stream
     Upgrades the ticker strip from polled to live.
  ───────────────────────────────────────────── */
  connectWebSocket() {
    // WS token is injected by /api/market.js as a short-lived token
    // so the Finnhub key never appears in client-side JS
    fetch('/api/market?action=ws-token')
      .then(r => r.json())
      .then(({ wsToken }) => {
        if (!wsToken) {
          console.warn('[DashboardLive] No WS token — staying on REST polling');
          return;
        }
        this._openWebSocket(wsToken);
      })
      .catch(err => {
        console.warn('[DashboardLive] WS token fetch failed:', err.message);
      });
  },

  _openWebSocket(token) {
    const url = `${this.config.wsEndpoint}?token=${token}`;
    this._ws = new WebSocket(url);

    this._ws.addEventListener('open', () => {
      this._wsConnected = true;
      console.log('[DashboardLive] WebSocket connected');

      // Subscribe to each symbol in watchlist
      this.config.watchlist.forEach(symbol => {
        this._ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      });

      // Once WS is up, slow down REST polling to reduce API calls
      clearInterval(this._pollingTimer);
      this._pollingTimer = setInterval(
        () => this.fetchData(),
        120000   // 2 min — only for news + fallback
      );
    });

    this._ws.addEventListener('message', e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'trade' || !msg.data) return;

        msg.data.forEach(trade => {
          // trade: { s: symbol, p: price, t: timestamp, v: volume }
          this.updateTickerFromWS(trade.s, trade.p);
        });
      } catch (err) {
        // Ignore malformed frames
      }
    });

    this._ws.addEventListener('close', () => {
      this._wsConnected = false;
      console.warn('[DashboardLive] WebSocket closed — falling back to REST polling');
      this.startPolling();
      // Reconnect after 30 seconds
      setTimeout(() => this.connectWebSocket(), 30000);
    });

    this._ws.addEventListener('error', err => {
      console.warn('[DashboardLive] WebSocket error:', err);
    });
  },

  /* ─────────────────────────────────────────────
     UI UPDATERS
  ───────────────────────────────────────────── */

  // Updates #live-price and #live-change elements (to be added in index.html Step 3)
  updatePriceUI(data) {
    const priceEl  = document.getElementById('live-price');
    const changeEl = document.getElementById('live-change');

    if (priceEl && data.price != null) {
      priceEl.textContent = `$${data.price.toFixed(2)}`;
    }

    if (changeEl && data.change != null) {
      const sign    = data.change >= 0 ? '+' : '';
      const isUp    = data.change >= 0;
      changeEl.textContent = `${sign}${data.change.toFixed(2)} (${data.percentChange.toFixed(2)}%)`;
      changeEl.style.color = isUp ? 'var(--green)' : 'var(--red)';
    }
  },

  // Feeds the existing tickerData array in index.html from WebSocket trades
  updateTickerFromWS(symbol, price) {
    // Bridge into the ticker strip already built in index.html
    if (typeof updateTickerItem === 'function') {
      updateTickerItem(symbol, price, null);
    }
  },

  // Updates #geopolitical-feed (to be added in index.html Step 3)
  // Receives Finnhub company news format:
  //   { datetime (unix), headline, summary, source, url }
  updateGeopoliticalNews(newsItems) {
    const container = document.getElementById('geopolitical-feed');
    if (!container) return;

    container.innerHTML = newsItems
      .slice(0, 8)   // show latest 8 items
      .map(item => {
        const time = new Date(item.datetime * 1000).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit'
        });
        const summary = (item.summary || '').substring(0, 100);
        return `
          <div style="border-bottom:1px solid var(--border-dim);padding:0.65rem 0;">
            <div style="display:flex;align-items:center;justify-content:space-between;
              margin-bottom:0.3rem;gap:0.5rem">
              <small style="color:var(--cyan);font-family:'IBM Plex Mono',monospace;
                font-size:0.6rem;letter-spacing:0.08em">${time}</small>
              <small style="color:var(--text-dim);font-family:'IBM Plex Mono',monospace;
                font-size:0.58rem">${item.source || ''}</small>
            </div>
            <div style="font-size:0.8rem;font-weight:600;color:var(--text-pri);
              margin-bottom:0.25rem;line-height:1.4">${item.headline}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);line-height:1.5">
              ${summary}${summary.length >= 100 ? '…' : ''}
            </div>
            ${item.url ? `
              <a href="${item.url}" target="_blank" rel="noopener"
                style="font-family:'IBM Plex Mono',monospace;font-size:0.6rem;
                color:var(--cyan);text-decoration:none;letter-spacing:0.08em">
                Read →
              </a>` : ''}
          </div>`;
      })
      .join('');
  },

  /* ─────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────── */

  // Switch the active symbol (e.g. called from a dropdown in index.html)
  setSymbol(symbol) {
    this.config.activeSymbol = symbol;
    this.fetchData();
  },

  // Graceful teardown (call before page unload if needed)
  destroy() {
    this.stopPolling();
    if (this._ws) {
      this.config.watchlist.forEach(s => {
        try { this._ws.send(JSON.stringify({ type: 'unsubscribe', symbol: s })); }
        catch(e) {}
      });
      this._ws.close();
    }
  }
};

/* ══════════════════════════════════════════════════════════
   AUTO-INIT — DISABLED until Step 3 setup is complete.
   To enable:
     1. Deploy /api/market.js to Vercel
     2. Add FINNHUB_API_KEY to Vercel Environment Variables
     3. Uncomment the block below and push to GitHub
   ══════════════════════════════════════════════════════════ */

// document.addEventListener('DOMContentLoaded', () => DashboardLive.init());
