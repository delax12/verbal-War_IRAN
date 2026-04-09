/**
 * LIVE DATA CONTROLLER — dashboard-live.js
 * ─────────────────────────────────────────
 * Handles API polling for live market prices and geopolitical news feed.
 * Feeds the #geopolitical-feed panel and #feedStatusDot in index.html.
 *
 * Polls /api/market (Finnhub proxy) every 30 seconds.
 * Updates the Live Market News section automatically on load.
 */

const DashboardLive = {

  config: {
    endpoint:    '/api/market',
    refreshRate: 30000,        // 30s REST polling (Finnhub free tier: 60 calls/min)
    activeSymbol:'SPY',
    watchlist:   ['XOM', 'LMT', 'RTX', 'DAL', 'GLD', 'SPY'],
  },

  _pollingTimer: null,
  _newsTimer:    null,

  /* ── INIT ── */
  init() {
    console.log('[DashboardLive] Initializing…');
    this.fetchNewsAndPrices();
    this.startPolling();
  },

  /* ── POLLING ── */
  startPolling() {
    clearInterval(this._pollingTimer);
    this._pollingTimer = setInterval(
      () => this.fetchNewsAndPrices(),
      this.config.refreshRate
    );
  },

  stopPolling() {
    clearInterval(this._pollingTimer);
    this._pollingTimer = null;
  },

  /* ── MAIN FETCH ── */
  async fetchNewsAndPrices() {
    try {
      const res = await fetch(`${this.config.endpoint}?symbol=${this.config.activeSymbol}`);
      if (!res.ok) throw new Error(`/api/market returned ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Update price display if elements exist
      this.updatePriceUI(data);

      // Update news feed
      if (data.news && data.news.length) {
        this.updateGeopoliticalNews(data.news);
      } else {
        this._setFeedStatus('No live news — retrying…', false);
      }

    } catch (err) {
      console.warn('[DashboardLive] fetchNewsAndPrices error:', err.message);
      this._setFeedStatus('Feed error — retrying in 30s', false);
    }
  },

  /* ── UI UPDATERS ── */
  updatePriceUI(data) {
    const priceEl  = document.getElementById('live-price');
    const changeEl = document.getElementById('live-change');

    if (priceEl && data.price != null) {
      priceEl.textContent = `$${data.price.toFixed(2)}`;
    }
    if (changeEl && data.change != null) {
      const sign  = data.change >= 0 ? '+' : '';
      const isUp  = data.change >= 0;
      changeEl.textContent = `${sign}${data.change.toFixed(2)} (${(data.percentChange || 0).toFixed(2)}%)`;
      changeEl.style.color = isUp ? 'var(--green, #00e676)' : 'var(--red, #ff3d4a)';
    }
  },

  updateGeopoliticalNews(newsItems) {
    const container = document.getElementById('geopolitical-feed');
    const statusDot = document.getElementById('feedStatusDot');

    // Update the feed status indicator
    if (statusDot) {
      statusDot.innerHTML =
        '<div style="width:6px;height:6px;border-radius:50%;background:var(--green,#00e676);' +
        'box-shadow:0 0 6px var(--green,#00e676);animation:pulse 1.8s infinite;display:inline-block"></div>' +
        '&nbsp;Live · ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }

    // Mirror to GEO Intelligence tab if function exists
    if (typeof mirrorFeedToGeoIntel === 'function') {
      try { mirrorFeedToGeoIntel(newsItems); } catch(e) {}
    }

    if (!container) return;

    const items = newsItems.slice(0, 8);
    if (!items.length) {
      container.innerHTML = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:.65rem;color:var(--text-dim,#5a7299);padding:.3rem 0">No headlines available.</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      // Finnhub returns datetime as unix timestamp (seconds)
      const ts   = item.datetime ? item.datetime * 1000 : Date.now();
      const time = new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      const headline = (item.headline || item.title || '').trim();
      const summary  = ((item.summary || item.description || '')).substring(0, 120).trim();
      const url      = item.url || item.link || '#';
      const source   = item.source || '';

      return `
        <div style="border-bottom:1px solid var(--border-dim,#152238);padding:.65rem 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;
            margin-bottom:.3rem;gap:.5rem">
            <small style="color:var(--cyan,#00d4ff);font-family:'IBM Plex Mono',monospace;
              font-size:.6rem;letter-spacing:.08em">${time}</small>
            <small style="color:var(--text-dim,#5a7299);font-family:'IBM Plex Mono',monospace;
              font-size:.58rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px">${source}</small>
          </div>
          <div style="font-size:.8rem;font-weight:600;color:var(--text-pri,#e8edf5);
            margin-bottom:.25rem;line-height:1.4">${headline}</div>
          ${summary ? `<div style="font-size:.7rem;color:var(--text-dim,#5a7299);line-height:1.5">
            ${summary}${summary.length >= 120 ? '…' : ''}
          </div>` : ''}
          ${url && url !== '#' ? `
            <a href="${url}" target="_blank" rel="noopener"
              style="font-family:'IBM Plex Mono',monospace;font-size:.6rem;
              color:var(--cyan,#00d4ff);text-decoration:none;letter-spacing:.08em">
              Read →
            </a>` : ''}
        </div>`;
    }).join('');
  },

  _setFeedStatus(message, isLive) {
    const statusDot = document.getElementById('feedStatusDot');
    if (!statusDot) return;
    const color = isLive ? 'var(--green,#00e676)' : 'var(--text-dim,#5a7299)';
    statusDot.innerHTML =
      `<div style="width:6px;height:6px;border-radius:50%;background:${color};` +
      `display:inline-block;margin-right:4px"></div>${message}`;
  },

  /* ── TICKER UPDATE (bridges to index.html's tickerData if available) ── */
  updateTickerFromWS(symbol, price) {
    if (typeof updateTickerItem === 'function') {
      updateTickerItem(symbol, price, null);
    }
  },

  setSymbol(symbol) {
    this.config.activeSymbol = symbol;
    this.fetchNewsAndPrices();
  },

  destroy() {
    this.stopPolling();
  }
};

/* ── AUTO-INIT on DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', () => {
  // Small delay so index.html's own DOMContentLoaded handler runs first
  setTimeout(() => DashboardLive.init(), 2500);
});
