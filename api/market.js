/**
 * /api/market.js — Vercel Serverless Function (Node.js / CommonJS)
 * ─────────────────────────────────────────────────────────────────
 * Live stock / commodity price proxy for DELAX GEO-RISK dashboard.
 *
 * FIX NOTES (v3 — stock popup price fixes):
 *
 *  FIX 5.1 — GOLD removed from SYMBOL_MAP.
 *    Previously GOLD → GLD (SPDR ETF), hijacking Barrick Gold (NYSE:GOLD)
 *    requests from the popup. Barrick's ticker GOLD is valid on Finnhub/AV
 *    and should pass through unchanged. Ticker seeds wanting GLD ETF already
 *    request 'GLD' directly.
 *
 *  FIX 5.2 — Finnhub prevClose (pc) used when current price (c) is zero.
 *    Finnhub returns c=0 after market hours, on weekends, and for some
 *    free-tier symbols. Previously c=0 triggered return null → 502.
 *    Now: c=0 but pc>0 → return pc as price with isEstimated:true.
 *    This ensures prices display at all times, not just during the
 *    6.5-hour regular market window (9:30am–4pm ET).
 *
 *  FIX 5.3 — Yahoo Finance fallback replaced with Alpha Vantage.
 *    Yahoo Finance returns 403 from all Vercel/AWS cloud IPs (confirmed).
 *    Alpha Vantage (ALPHA_VANTAGE_KEY already in Vercel) is designed for
 *    server-side access and works reliably from serverless environments.
 *    Note: AV free tier = 25 req/day. Sufficient for popup use (4 symbols
 *    per click). Commodity futures (BRENT, WTI, NG) are Finnhub-only.
 *
 *  FIX 5.4 — Error responses no longer edge-cached.
 *    Cache-Control: s-maxage=30 now only set on 200 success responses.
 *    Previously, 502 errors were cached for 30s causing all users to
 *    see "—" prices even after the upstream source recovered.
 *
 * Sources (priority order):
 *   1. Finnhub  — primary   (FINNHUB_API_KEY,    free 60 req/min)
 *   2. Alpha Vantage — fallback (ALPHA_VANTAGE_KEY, free 25 req/day)
 */
'use strict';

/* ── Symbol normalisation ──────────────────────────────────────────
   Maps dashboard IDs → real market tickers.
   NOTE: GOLD is intentionally absent. NYSE:GOLD (Barrick Gold) is a
   valid Finnhub symbol. Ticker seeds wanting GLD ETF request 'GLD'.
─────────────────────────────────────────────────────────────────── */
const SYMBOL_MAP = {
  BRENT:  'BZ=F',      // Brent Crude futures
  WTI:    'CL=F',      // WTI Crude futures
  NG:     'NG=F',      // Natural Gas futures
  NATGAS: 'NG=F',      // alias used by index.html TICKER_SEEDS
  SPX:    'SPY',       // S&P 500 ETF proxy (georisk ticker id:'SPX')
  VIX:    '^VIX',      // CBOE Volatility Index
  DXY:    'DX-Y.NYB',  // US Dollar Index
  EMCS:   'EEM',       // EM ETF proxy for EM Credit Spread
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const rawSymbol = (req.query.symbol || '').toUpperCase().trim();
  if (!rawSymbol) return res.status(400).json({ error: 'symbol query parameter required' });

  const symbol      = SYMBOL_MAP[rawSymbol] || rawSymbol;
  const finnhubKey  = process.env.FINNHUB_API_KEY;
  const avKey       = process.env.ALPHA_VANTAGE_KEY;

  /* ── 1. Finnhub (primary) ────────────────────────────────────── */
  if (finnhubKey) {
    try {
      const result = await fetchFinnhub(symbol, finnhubKey);
      if (result) {
        /* FIX 5.4: only cache successful responses */
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) {
      console.warn('[market] Finnhub failed:', err.message);
    }
  } else {
    console.warn('[market] FINNHUB_API_KEY not set — skipping Finnhub');
  }

  /* ── 2. Alpha Vantage (fallback for stocks/ETFs) ─────────────── */
  /* Note: AV does not support futures (BZ=F, CL=F, NG=F).
     For commodity IDs the caller gets a 502 from here — that's correct. */
  const isFutures = symbol.endsWith('=F') || symbol.startsWith('^') || symbol.includes('-Y.');
  if (avKey && !isFutures) {
    try {
      const result = await fetchAlphaVantage(symbol, avKey);
      if (result) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
        return res.status(200).json({ ...result, requestedSymbol: rawSymbol });
      }
    } catch (err) {
      console.warn('[market] Alpha Vantage failed:', err.message);
    }
  } else if (!avKey) {
    console.warn('[market] ALPHA_VANTAGE_KEY not set — skipping AV fallback');
  }

  /* ── 3. Both failed ──────────────────────────────────────────── */
  /* FIX 5.4: no Cache-Control on errors */
  return res.status(502).json({
    error:  'All price sources failed',
    symbol: rawSymbol,
    hints: [
      'Ensure FINNHUB_API_KEY is set correctly in Vercel (no surrounding quotes/spaces)',
      'After market hours: Finnhub returns c=0; fallback to prevClose is applied automatically',
      'For commodity futures (BRENT/WTI/NG): only Finnhub is supported',
    ],
  });
};

/* ─── Finnhub quote fetch ─────────────────────────────────────────
   FIX 5.2: When c=0 (after-hours/weekend), use prevClose (pc) field
   and flag the result as isEstimated:true so the UI can label it.
──────────────────────────────────────────────────────────────────── */
async function fetchFinnhub(symbol, apiKey) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 5000);

  try {
    const url  = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);
    const data = await resp.json();

    /* FIX 5.2: c=0 with valid prevClose → use prevClose, mark estimated */
    const currentPrice = data.c;
    const prevClose    = data.pc;

    if ((!currentPrice || currentPrice === 0) && (!prevClose || prevClose === 0)) {
      return null; // symbol genuinely not found
    }

    const price = (currentPrice && currentPrice !== 0) ? currentPrice : prevClose;
    const isEstimated = (!currentPrice || currentPrice === 0);

    /* change/percentChange relative to prevClose */
    const change        = prevClose ? price - prevClose : 0;
    const percentChange = prevClose ? (change / prevClose) * 100 : 0;

    return {
      symbol,
      price:         parseFloat(price.toFixed(4)),
      change:        parseFloat(change.toFixed(4)),
      percentChange: parseFloat(percentChange.toFixed(4)),
      high:          data.h   || null,
      low:           data.l   || null,
      open:          data.o   || null,
      prevClose:     prevClose || null,
      isEstimated,          // true = after-hours / prev-close value
      currency:      'USD',
      source:        'Finnhub',
      timestamp:     new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Finnhub timeout');
    throw err;
  }
}

/* ─── Alpha Vantage GLOBAL_QUOTE fallback ─────────────────────────
   Supports NYSE/NASDAQ stocks and ETFs. Does NOT support futures.
──────────────────────────────────────────────────────────────────── */
async function fetchAlphaVantage(symbol, apiKey) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 6000);

  try {
    const url  = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Alpha Vantage HTTP ${resp.status}`);
    const json = await resp.json();

    /* AV rate-limit message */
    if (json?.Note || json?.Information) {
      throw new Error('Alpha Vantage rate limit reached (25 req/day on free tier)');
    }

    const q = json?.['Global Quote'];
    if (!q || !q['05. price']) return null;

    const price      = parseFloat(q['05. price']);
    const prevClose  = parseFloat(q['08. previous close'] || q['05. price']);
    const change     = parseFloat(q['09. change']         || '0');
    const pctRaw     = (q['10. change percent'] || '0%').replace('%', '');
    const pct        = parseFloat(pctRaw);

    if (!price || isNaN(price)) return null;

    return {
      symbol,
      price:         parseFloat(price.toFixed(4)),
      change:        parseFloat(change.toFixed(4)),
      percentChange: parseFloat(pct.toFixed(4)),
      prevClose:     parseFloat(prevClose.toFixed(4)),
      isEstimated:   false,
      currency:      'USD',
      source:        'Alpha Vantage',
      timestamp:     new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Alpha Vantage timeout');
    throw err;
  }
}
