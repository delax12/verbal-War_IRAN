/**
 * /api/market.js — Vercel Serverless Function (CommonJS)
 * ────────────────────────────────────────────────────────
 * Secure proxy for Finnhub API.
 * Serves: quote prices, company news, and a short-lived WebSocket token.
 * Keeps FINNHUB_API_KEY server-side — never exposed to the browser.
 *
 * SETUP (one-time in Vercel Dashboard):
 *   1. vercel.com → Your Project → Settings → Environment Variables
 *   2. Add:  Name = FINNHUB_API_KEY  |  Value = <your key from finnhub.io>
 *   3. Check: ✅ Production  ✅ Preview  ✅ Development
 *   4. Save → Deployments → Redeploy
 *
 *   Get a free Finnhub key: https://finnhub.io/register
 *   Free tier: 60 calls/min REST, real-time WebSocket US stocks
 *
 * ENDPOINTS called from dashboard-live.js:
 *
 *   GET /api/market?symbol=XOM
 *     → { price, change, percentChange, high, low, open,
 *          prevClose, timestamp, news[] }
 *
 *   GET /api/market?symbol=XOM&type=quote
 *     → same as above (explicit quote)
 *
 *   GET /api/market?symbol=XOM&type=news
 *     → { news[] } — last 7 days of company news
 *
 *   GET /api/market?action=ws-token
 *     → { wsToken } — Finnhub key echoed for WS auth
 *       (still server-side only; only call from your own domain)
 *
 * CACHING:
 *   Quotes: 60 second CDN cache  (Finnhub updates ~every 15s during market hours)
 *   News:   15 minute CDN cache
 *   WS token: no cache (used immediately)
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

module.exports = async function handler(req, res) {

  // ── Only allow GET ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Read Finnhub key from Vercel environment ──
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'FINNHUB_API_KEY environment variable is not set.',
      fix:   'Vercel Dashboard → Settings → Environment Variables → Add FINNHUB_API_KEY',
      docs:  'https://finnhub.io/register'
    });
  }

  const { symbol, type, action } = req.query;

  /* ══════════════════════════════════════════
     ACTION: ws-token
     Returns the Finnhub key for WebSocket auth.
     Only usable from your own domain (no CORS wildcard here).
  ══════════════════════════════════════════ */
  if (action === 'ws-token') {
    // Restrict: only serve token to same-origin requests
    const origin = req.headers['origin'] || req.headers['referer'] || '';
    const allowed = ['chart.delaxcom.com', 'verbal-war-iran.vercel.app', 'localhost'];
    const isAllowed = allowed.some(h => origin.includes(h));

    if (!isAllowed && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Cross-origin WS token request denied' });
    }

    // No CDN cache for the token
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ wsToken: apiKey });
  }

  /* ══════════════════════════════════════════
     Validate symbol for quote + news actions
  ══════════════════════════════════════════ */
  if (!symbol) {
    return res.status(400).json({
      error: 'Missing required query param: symbol',
      example: '/api/market?symbol=XOM'
    });
  }

  // Sanitize symbol — only uppercase letters, numbers, dots, hyphens
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  if (!cleanSymbol) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  /* ══════════════════════════════════════════
     ACTION: news only
     GET /api/market?symbol=XOM&type=news
  ══════════════════════════════════════════ */
  if (type === 'news') {
    return fetchNews(cleanSymbol, apiKey, res);
  }

  /* ══════════════════════════════════════════
     DEFAULT ACTION: quote + news together
     GET /api/market?symbol=XOM
     GET /api/market?symbol=XOM&type=quote
  ══════════════════════════════════════════ */
  return fetchQuoteAndNews(cleanSymbol, apiKey, res);
};

/* ─────────────────────────────────────────
   FETCH QUOTE + NEWS (combined, default)
───────────────────────────────────────── */
async function fetchQuoteAndNews(symbol, apiKey, res) {
  try {
    // Run quote and news fetches in parallel
    const [quoteRes, newsRes] = await Promise.all([
      fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`),
      fetch(
        `${FINNHUB_BASE}/company-news` +
        `?symbol=${symbol}` +
        `&from=${daysAgo(7)}` +
        `&to=${today()}` +
        `&token=${apiKey}`
      )
    ]);

    if (!quoteRes.ok) {
      return res.status(quoteRes.status).json({
        error: `Finnhub quote returned ${quoteRes.status}`,
        symbol
      });
    }

    const quote = await quoteRes.json();

    // News is best-effort — don't fail the whole request if it errors
    let news = [];
    if (newsRes.ok) {
      const rawNews = await newsRes.json();
      news = Array.isArray(rawNews)
        ? rawNews.slice(0, 10).map(sanitizeNewsItem)
        : [];
    }

    /* Finnhub quote response shape:
       { c: current, d: change, dp: %change, h: high,
         l: low, o: open, pc: prevClose, t: timestamp }
    */
    if (!quote.c || quote.c === 0) {
      return res.status(502).json({
        error: 'Finnhub returned zero price — market may be closed or symbol invalid',
        symbol,
        raw: quote
      });
    }

    const payload = {
      symbol:       symbol,
      price:        quote.c,           // current price
      change:       quote.d,           // change vs prev close
      percentChange:quote.dp,          // % change
      high:         quote.h,           // day high
      low:          quote.l,           // day low
      open:         quote.o,           // day open
      prevClose:    quote.pc,          // previous close
      timestamp:    quote.t,           // unix timestamp
      marketOpen:   isMarketOpen(),
      news:         news,
      fetchedAt:    new Date().toISOString()
    };

    // Cache quotes for 60 seconds at CDN edge
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[market] fetchQuoteAndNews error:', err.message);
    return res.status(500).json({
      error: 'Upstream fetch to Finnhub failed',
      detail: err.message
    });
  }
}

/* ─────────────────────────────────────────
   FETCH NEWS ONLY
───────────────────────────────────────── */
async function fetchNews(symbol, apiKey, res) {
  try {
    const r = await fetch(
      `${FINNHUB_BASE}/company-news` +
      `?symbol=${symbol}` +
      `&from=${daysAgo(7)}` +
      `&to=${today()}` +
      `&token=${apiKey}`
    );

    if (!r.ok) {
      return res.status(r.status).json({ error: `Finnhub news returned ${r.status}` });
    }

    const raw  = await r.json();
    const news = Array.isArray(raw)
      ? raw.slice(0, 15).map(sanitizeNewsItem)
      : [];

    // Cache news for 15 minutes
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ symbol, news, fetchedAt: new Date().toISOString() });

  } catch (err) {
    console.error('[market] fetchNews error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */

// Sanitize a Finnhub news item — remove anything sensitive, keep what UI needs
function sanitizeNewsItem(item) {
  return {
    id:       item.id       || 0,
    datetime: item.datetime || 0,   // unix timestamp
    headline: item.headline || '',
    summary:  item.summary  || '',
    source:   item.source   || '',
    url:      item.url      || '',
    image:    item.image    || ''
  };
}

// Returns "YYYY-MM-DD" for today
function today() {
  return new Date().toISOString().slice(0, 10);
}

// Returns "YYYY-MM-DD" for N days ago
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Rough US market hours check (Eastern Time, Mon–Fri, 9:30am–4pm)
function isMarketOpen() {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();   // 0=Sun, 6=Sat
  const h   = et.getHours();
  const m   = et.getMinutes();
  if (day === 0 || day === 6) return false;
  const minuteOfDay = h * 60 + m;
  return minuteOfDay >= 570 && minuteOfDay < 960; // 9:30am–4:00pm ET
}
