/**
 * LIVE DATA CONTROLLER — dashboard-live.js  (v2 — FIXED)
 * ─────────────────────────────────────────────────────────
 * FIX NOTES:
 *  • fetchNewsFromRSS: now calls /api/news directly (no brittle .replace()).
 *    Parses the { news: [...] } shape returned by the new api/news.js.
 *  • fetchPrices: now batch-fetches ALL watchlist symbols in parallel instead
 *    of only the single activeSymbol — this fills the entire ticker strip.
 *  • Ticker update bridges to both `tickerData` (index.html) and the
 *    georisk-intelligence.html `jitterMarkets` / `updateTicker` globals.
 *  • Feed status dot updated on every successful/failed fetch cycle.
 *  • Static fallback news removed — the real API now works.
 */
'use strict';

const DashboardLive = {

  config: {
    marketEndpoint: '/api/market',
    newsEndpoint:   '/api/news',
    refreshRate:     30000,   // 30 s — stock prices
    newsRefreshRate: 480000,  // 8 min — Fix 1.4: was 120000 (2min = ~720 req/day, blows free quota of 100)
    // FIX 7.2: IDs must exactly match TICKER_SEEDS ids in index.html.
    // Previous list had SPY/WTI/VIX/NG — none exist in TICKER_SEEDS.
    // findIndex() returned -1 for all four → prices fetched then silently discarded.
    watchlist: ['BRENT', 'GOLD', 'XOM', 'LMT', 'RTX', 'DAL', 'GLD', 'DXY', 'NATGAS'],
  },

  _priceTimer: null,
  _newsTimer:  null,

  /* ── INIT ───────────────────────────────────────────────── */
  init() {
    console.log('[DashboardLive] v2 initialising…');
    this.fetchAllPrices();
    this.fetchNewsFromRSS();
    this.startPolling();
  },

  /* ── POLLING ─────────────────────────────────────────────── */
  startPolling() {
    clearInterval(this._priceTimer);
    clearInterval(this._newsTimer);
    this._priceTimer = setInterval(() => this.fetchAllPrices(),    this.config.refreshRate);
    this._newsTimer  = setInterval(() => this.fetchNewsFromRSS(),  this.config.newsRefreshRate);
  },

  stopPolling() {
    clearInterval(this._priceTimer);
    clearInterval(this._newsTimer);
    this._priceTimer = null;
    this._newsTimer  = null;
  },

  /* ── FETCH ALL WATCHLIST PRICES IN PARALLEL ──────────────── */
  async fetchAllPrices() {
    const results = await Promise.allSettled(
      this.config.watchlist.map(sym =>
        fetch(`${this.config.marketEndpoint}?symbol=${encodeURIComponent(sym)}`)
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(d => ({ sym, data: d }))
      )
    );

    let anyUpdated = false;

    results.forEach(r => {
      if (r.status !== 'fulfilled') {
        console.warn('[DashboardLive] Price fetch failed for a symbol:', r.reason?.message);
        return;
      }
      const { sym, data } = r.value;
      if (!data || data.error || data.price == null) return;

      anyUpdated = true;
      const newPrice = parseFloat(data.price);

      // ── Update index.html tickerData global ──
      // BUG 7 FIX: index.html uses 'prevPrice', georisk uses 'prev' — write BOTH
      if (window.tickerData && Array.isArray(window.tickerData)) {
        const idx = window.tickerData.findIndex(
          t => t.id === sym || t.id === (data.requestedSymbol || sym)
        );
        if (idx >= 0) {
          const current = window.tickerData[idx].price;
          window.tickerData[idx] = {
            ...window.tickerData[idx],
            prev:      current,   // georisk-intelligence.html field name
            prevPrice: current,   // index.html field name
            price:     parseFloat(newPrice.toFixed(window.tickerData[idx].price > 100 ? 2 : 3)),
            live:      true,
          };
        }
      }

      // ── Update single-symbol price KPI display ──
      if (sym === 'SPY' || sym === this.config.watchlist[0]) {
        this._updatePriceUI(data);
      }
    });

    if (anyUpdated) {
      if (typeof window.updateTicker  === 'function') window.updateTicker();
      if (typeof window.renderTicker  === 'function') window.renderTicker();
    }
  },

  /* ── FETCH NEWS FROM /api/news ───────────────────────────── */
  async fetchNewsFromRSS() {
    try {
      const res = await fetch(this.config.newsEndpoint);
      if (!res.ok) throw new Error(`/api/news returned ${res.status}`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const items = data.news || [];
      if (items.length > 0) {
        this._updateGeopoliticalNews(items);
        this._setFeedStatus(`Live · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, true);
      } else {
        this._setFeedStatus('No headlines available', false);
      }

    } catch (err) {
      console.warn('[DashboardLive] fetchNewsFromRSS error:', err.message);
      this._setFeedStatus('Feed error — retrying…', false);
    }
  },

  /* ── PRIVATE: update #geopolitical-feed ──────────────────── */
  _updateGeopoliticalNews(newsItems) {
    const container = document.getElementById('geopolitical-feed');

    // Mirror to GEO Intelligence tab if the function exists (georisk-intelligence.html)
    if (typeof mirrorFeedToGeoIntel === 'function') {
      try { mirrorFeedToGeoIntel(newsItems); } catch(e) {}
    }

    if (!container) return;

    const items = newsItems.slice(0, 10);
    if (!items.length) {
      container.innerHTML =
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:.65rem;' +
        'color:var(--text-dim,#5a7299);padding:.3rem 0">No headlines available.</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const ts      = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      const time    = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const headline = _esc((item.title || item.headline || '').trim());
      const summary  = _esc((item.description || item.summary || '').substring(0, 140).trim());
      const url      = item.link || item.url || '#';
      const source   = _esc((item.source || 'RSS Feed').substring(0, 24));

      return `
        <div style="border-bottom:1px solid var(--border-dim,#152238);padding:.65rem 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;
              margin-bottom:.3rem;gap:.5rem">
            <small style="color:var(--cyan,#00d4ff);font-family:'IBM Plex Mono',monospace;
              font-size:.6rem;letter-spacing:.08em">${time}</small>
            <small style="color:var(--text-dim,#5a7299);font-family:'IBM Plex Mono',monospace;
              font-size:.58rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
              max-width:110px">${source}</small>
          </div>
          <div style="font-size:.8rem;font-weight:600;color:var(--text-pri,#e8edf5);
            margin-bottom:.25rem;line-height:1.4">${headline}</div>
          ${summary
            ? `<div style="font-size:.7rem;color:var(--text-dim,#5a7299);line-height:1.5">
                 ${summary}${summary.length >= 140 ? '…' : ''}
               </div>`
            : ''}
          ${url && url !== '#'
            ? `<a href="${url}" target="_blank" rel="noopener"
                 style="font-family:'IBM Plex Mono',monospace;font-size:.6rem;
                 color:var(--cyan,#00d4ff);text-decoration:none;letter-spacing:.08em">
                 Read →</a>`
            : ''}
        </div>`;
    }).join('');
  },

  /* ── PRIVATE: price KPI display ─────────────────────────── */
  _updatePriceUI(data) {
    const priceEl  = document.getElementById('live-price');
    const changeEl = document.getElementById('live-change');

    if (priceEl  && data.price  != null)
      priceEl.textContent = `$${data.price.toFixed(2)}`;

    if (changeEl && data.change != null) {
      const sign = data.change >= 0 ? '+' : '';
      changeEl.textContent = `${sign}${data.change.toFixed(2)} (${(data.percentChange || 0).toFixed(2)}%)`;
      changeEl.style.color = data.change >= 0
        ? 'var(--green,#00e676)'
        : 'var(--red,#ff3d4a)';
    }
  },

  /* ── PRIVATE: feed status indicator ─────────────────────── */
  _setFeedStatus(message, isLive) {
    const dot   = document.getElementById('feedStatusDot');
    if (!dot) return;
    const color = isLive ? 'var(--green,#00e676)' : 'var(--text-dim,#5a7299)';
    const pulse = isLive
      ? 'animation:pulse 1.8s infinite;box-shadow:0 0 6px var(--green,#00e676);'
      : '';
    dot.innerHTML =
      `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;` +
      `background:${color};${pulse}vertical-align:middle;margin-right:4px"></span>${message}`;
  },

  /* ── PUBLIC aliases for index.html direct calls ─────────── */
  updateGeopoliticalNews(items) { this._updateGeopoliticalNews(items); },
  setFeedStatus(msg, live)      { this._setFeedStatus(msg, live); },

  setSymbol(symbol) {
    if (!this.config.watchlist.includes(symbol)) {
      this.config.watchlist.push(symbol);
    }
    this.fetchAllPrices();
  },

  destroy() { this.stopPolling(); },
};

/* tiny XSS guard */
function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── AUTO-INIT after DOM ready ──────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => DashboardLive.init(), 600));
} else {
  setTimeout(() => DashboardLive.init(), 600);
}
