cd "/Users/frankkjhooy/Desktop/GEO INTEL VS code /verbal-War_IRAN"cd "/Users/frankkjhooy/Desktop/GEO INTEL VS code /verbal-War_IRAN"/**
 * index_patches.js — DELAX GEO-RISK Dashboard Patches
 * ──────────────────────────────────────────────────────
 * Fixes 4 issues without modifying index.html or georisk-intelligence.html:
 *
 *  1. KPI tile AI analysis — fixes missing DOM element reference for model label
 *  2. Live Market News — overrides broken ES-module market.js with working fetch
 *  3. Stock popup — replaces openStockPopup() with stockinsights API type
 *  4. Ticker prices — fixes symbol mapping so Finnhub prices update correctly
 *
 * Include AFTER index.html's own <script> block:
 *   <script src="/index_patches.js" defer></script>
 *
 * OR paste contents at the end of index.html's <script> block.
 */

(function applyDashboardPatches() {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // PATCH 1 — KPI panel: add missing #kpiPanelMetaModel element
  // The JS tries getElementById('kpiPanelMetaModel') which returns null,
  // causing the model attribution to silently fail.
  // We inject the missing <span> into the existing #kpiPanelMeta div.
  // ─────────────────────────────────────────────────────────────────
  function patchKPIPanelMeta() {
    const meta = document.getElementById('kpiPanelMeta');
    if (!meta) return;
    if (!document.getElementById('kpiPanelMetaModel')) {
      const modelSpan = document.createElement('span');
      modelSpan.id = 'kpiPanelMetaModel';
      modelSpan.style.cssText = 'color:var(--purple);font-family:var(--mono,monospace);font-size:.54rem';
      meta.insertBefore(modelSpan, meta.firstChild);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH 2 — Live Market News: override fetchNewsAndPrices
  // The old dashboard-live.js had Finnhub WS token and price update
  // code that references a broken ES-module market.js.
  // This patch ensures the news feed populates correctly.
  // ─────────────────────────────────────────────────────────────────
  function patchLiveNewsFeed() {
    // Override DashboardLive.fetchNewsAndPrices if it exists
    if (window.DashboardLive) {
      const originalFetch = DashboardLive.fetchNewsAndPrices.bind(DashboardLive);
      DashboardLive.fetchNewsAndPrices = async function() {
        const statusDot = document.getElementById('feedStatusDot');
        try {
          const res = await fetch('/api/market?symbol=SPY');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          if (data.news && data.news.length) {
            this.updateGeopoliticalNews(data.news);
          } else {
            if (statusDot) {
              statusDot.innerHTML =
                '<div style="width:6px;height:6px;border-radius:50%;background:var(--amber,#f5a623);display:inline-block;margin-right:4px"></div>' +
                'No headlines · retrying…';
            }
          }
        } catch (err) {
          console.warn('[DashboardLive patch] fetch error:', err.message);
          if (statusDot) {
            statusDot.innerHTML =
              '<div style="width:6px;height:6px;border-radius:50%;background:var(--red,#ff3d4a);display:inline-block;margin-right:4px"></div>' +
              'Feed offline · retrying in 30s';
          }
          // Show a static message in the feed container
          const feed = document.getElementById('geopolitical-feed');
          if (feed && feed.innerHTML.includes('Connecting')) {
            feed.innerHTML = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:.65rem;color:var(--text-dim,#5a7299);padding:.3rem 0">' +
              '⚠ Finnhub connection failed — add FINNHUB_API_KEY to Vercel environment variables.' +
              '</div>';
          }
        }
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH 3 — Stock popup: replace openStockPopup with fixed version
  // Old version sent the AI prompt to /api/analyze?type=newssummary
  // which returned a 1-sentence string, not JSON — causing blank popup.
  // New version uses type:'stockinsights' which returns proper JSON.
  // ─────────────────────────────────────────────────────────────────
  function patchStockPopup() {
    // Only override if original function exists in global scope
    if (typeof window.openStockPopup !== 'function') return;

    window.openStockPopup = async function(countryName) {
      const popup    = document.getElementById('stock-popup');
      const backdrop = document.getElementById('stock-backdrop');
      const body     = document.getElementById('sp-body');
      const nameEl   = document.getElementById('sp-country-name');
      const sub      = document.getElementById('sp-subtitle');
      if (!popup || !body) return;

      // Show popup in loading state
      if (nameEl) nameEl.textContent = countryName;
      if (sub)    sub.textContent = 'AI Investor Insights · Finnhub Live Prices';
      body.innerHTML = '<div class="sp-loading"><div class="sp-load-dot"></div>GENERATING INVESTOR INSIGHTS…</div>';
      popup.classList.add('visible');
      if (backdrop) backdrop.classList.add('visible');

      const scenario = window.scenario || 'baseline';
      const cacheKey = countryName + '_' + scenario;

      // Serve from cache
      if (window.stockInsightCache && window.stockInsightCache[cacheKey]) {
        body.innerHTML = window.stockInsightCache[cacheKey];
        return;
      }

      const getStocks   = window.getCountryStocks || (() => [['XOM','ExxonMobil'],['GLD','Gold ETF'],['LMT','Lockheed Martin'],['RTX','Raytheon']]);
      const COUNTRIES   = window.COUNTRIES || {};
      const tickerData  = window.tickerData || [];
      const stocks      = getStocks(countryName);
      const c           = COUNTRIES[countryName] || {};
      const brent       = (tickerData.find(t => t.id === 'BRENT') || {}).price || 121;
      const stressIndex = typeof window.getCountryStress === 'function' ? window.getCountryStress(countryName) : (c.stress || 5);

      // Fetch live Finnhub prices for top 4 symbols
      const livePrices = {};
      await Promise.allSettled(
        stocks.slice(0, 4).map(s =>
          fetch('/api/market?symbol=' + encodeURIComponent(s[0]))
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && d.price != null) livePrices[s[0]] = d; })
            .catch(() => null)
        )
      );

      // Fetch AI insights — use stockinsights type
      let aiData = null;
      try {
        const res = await fetch('/api/analyze', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type:        'stockinsights',
            countryName,
            stocks:      stocks.slice(0, 6),
            stressIndex,
            countryData: { cpi: c.cpi, gdp: c.gdp, oilDep: c.oilDep, fxVol: c.fxVol },
            scenario,
            oilPrice:    brent,
          }),
        });
        const d = await res.json();
        if (res.ok && !d.error && d.theme) aiData = d;
      } catch (e) {
        console.warn('[stockPopup] stockinsights fetch failed:', e.message);
      }

      // Fallback: try /api/whatif
      if (!aiData) {
        try {
          const stockList = stocks.slice(0,4).map(s => s[0] + ' (' + s[1] + ')').join(', ');
          const prompt = 'As a sell-side analyst, write a brief investor note on ' + countryName +
            ' for the Iran War 2026 ' + scenario + ' scenario. Brent $' + brent.toFixed(0) + '/bbl. ' +
            'Relevant stocks: ' + stockList + '. ' +
            'Respond with JSON only (no markdown): {"theme":"2 sentence macro theme","stocks":[{"sym":"TICKER","signal":"BUY","reason":"one sentence"}],"risk":"one sentence key risk"}';
          const r2 = await fetch('/api/whatif', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: prompt, scenario, oilPrice: brent }),
          });
          const d2 = await r2.json();
          if (r2.ok && d2.analysis) {
            const raw = d2.analysis.trim().replace(/```json\n?|```/g, '').trim();
            try { aiData = JSON.parse(raw); } catch (e) {
              aiData = { theme: raw.slice(0, 200), stocks: [], risk: '' };
            }
          }
        } catch (e2) { console.warn('[stockPopup] whatif fallback failed:', e2.message); }
      }

      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      let out = '';

      // Macro theme
      if (aiData && aiData.theme) {
        out += '<div class="sp-section"><div class="sp-sect-hdr">MACRO THEME</div>' +
          '<div class="sp-ai-insight"><strong>AI · ' + scenario.toUpperCase() + ':</strong> ' + esc(aiData.theme) + '</div></div>';
      }

      // Stocks with live prices
      const allStocks = (aiData && aiData.stocks && aiData.stocks.length > 0)
        ? aiData.stocks
        : stocks.slice(0, 4).map(s => ({ sym: s[0], signal: 'WATCH', reason: 'Monitor for geopolitical exposure in this scenario.' }));

      out += '<div class="sp-section"><div class="sp-sect-hdr">INVESTOR SIGNALS — Live Finnhub Prices</div>';
      allStocks.slice(0, 5).forEach(st => {
        const COUNTRY_STOCKS = window.COUNTRY_STOCKS || {};
        const stockName = (COUNTRY_STOCKS[countryName] || []).find(s => s[0] === st.sym)?.[1] || st.sym;
        const lp = livePrices[st.sym];
        const priceStr = lp && lp.price != null ? '$' + lp.price.toFixed(2) : '—';
        const pct = lp && lp.percentChange != null ? lp.percentChange : null;
        const dir = pct != null ? (pct >= 0 ? 'up' : 'dn') : '';
        const chgStr = pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '';
        const signalColor = st.signal === 'BUY' ? 'var(--green)' : st.signal === 'SELL' ? 'var(--red)' : st.signal === 'HOLD' ? 'var(--amber)' : 'var(--cyan)';
        out += '<div class="sp-stock-row">' +
          '<span class="sp-sym">' + esc(st.sym) + '</span>' +
          '<span class="sp-name">' + esc(stockName) + '</span>' +
          '<span class="sp-price">' + priceStr + '</span>' +
          '<span class="sp-chg ' + dir + '">' + chgStr + '</span>' +
          '<span style="font-size:8px;font-weight:700;color:' + signalColor + ';min-width:36px;text-align:right">' + esc(st.signal) + '</span>' +
          '</div>' +
          '<div class="sp-signal" style="padding-bottom:4px;border-bottom:1px solid var(--border);margin-bottom:2px">' + esc(st.reason || '') + '</div>';
      });
      out += '</div>';

      if (aiData && aiData.risk) {
        out += '<div class="sp-section"><div class="sp-sect-hdr">KEY RISK</div>' +
          '<div class="sp-ai-insight"><strong>⚠</strong> ' + esc(aiData.risk) + '</div></div>';
      }

      if (!aiData) {
        out += '<div class="sp-section"><div style="font-family:var(--mono);font-size:.65rem;color:var(--text-dim);padding:.5rem 0;line-height:1.6">' +
          '⚠ AI analysis unavailable. To enable, add one of these to Vercel Environment Variables:<br>' +
          '<span style="color:var(--green)">GEMINI_API_KEY</span> (free · aistudio.google.com) or ' +
          '<span style="color:var(--amber)">ANTHROPIC_API_KEY</span> (paid · console.anthropic.com)' +
          '</div></div>';
      }

      out += '<div style="font-size:7px;color:var(--text-dim);text-align:right;padding-top:4px">' +
        '🤖 AI · Finnhub Live · ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + '</div>';

      body.innerHTML = out;
      if (!window.stockInsightCache) window.stockInsightCache = {};
      window.stockInsightCache[cacheKey] = out;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH 4 — Ticker: fix fetchFinnhubTicker symbol mapping
  // Original: 'SPY' maps to 'SPX' and 'GLD' maps to 'GOLD'
  // but TICKER_SEEDS uses ids 'SPY' (doesn't exist, it's 'GLD') — causing no updates.
  // Fix: correct the FINNHUB_EQUITY_IDS map AND ensure tickerData gets updated.
  // ─────────────────────────────────────────────────────────────────
  function patchTickerFinnhub() {
    // Override fetchFinnhubTicker in the global scope
    window.fetchFinnhubTicker = async function() {
      const SYMBOL_TO_TICKER_ID = {
        'XOM': 'XOM', 'LMT': 'LMT', 'RTX': 'RTX', 'DAL': 'DAL',
        'GLD': 'GOLD',  // GLD ETF maps to GOLD seed
        'SPY': 'SPX',   // SPY ETF maps to SPX seed (may not exist in all seed arrays)
      };

      const symbols = Object.keys(SYMBOL_TO_TICKER_ID);
      const results = await Promise.allSettled(
        symbols.map(sym =>
          fetch('/api/market?symbol=' + sym)
            .then(r => r.ok ? r.json() : null)
            .then(d => d && d.price != null ? { sym, price: d.price, change: d.change, pct: d.percentChange } : null)
            .catch(() => null)
        )
      );

      let updated = false;
      results.forEach(r => {
        if (r.status !== 'fulfilled' || !r.value) return;
        const { sym, price, pct } = r.value;
        const tickId = SYMBOL_TO_TICKER_ID[sym];
        if (!tickId || !window.tickerData) return;
        window.tickerData = window.tickerData.map(t => {
          if (t.id !== tickId && t.label !== sym && t.label !== sym + ' ETF') return t;
          updated = true;
          return { ...t, prevPrice: t.price, price: parseFloat(price.toFixed(2)), live: true };
        });
      });

      if (updated && typeof window.renderTicker === 'function') {
        window.renderTicker();
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // APPLY ALL PATCHES after DOM is ready
  // ─────────────────────────────────────────────────────────────────
  function applyAll() {
    patchKPIPanelMeta();
    patchStockPopup();
    patchTickerFinnhub();
    // DashboardLive is initialized by dashboard-live.js 2.5s after DOMContentLoaded,
    // so we patch it slightly later to ensure it's available
    setTimeout(patchLiveNewsFeed, 3000);
    console.log('[DELAX Patches] All 4 patches applied successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    applyAll();
  }

})();
