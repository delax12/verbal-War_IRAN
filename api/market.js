// File: /api/market.js
// Vercel Serverless Function (CommonJS) — Finnhub proxy
// Keeps FINNHUB_API_KEY server-side; never exposed to browser.
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || 'd768gopr01qm4b7tbbm0d768gopr01qm4b7tbbmg';
  const { symbol, action } = req.query;

  // WebSocket token endpoint (used by dashboard-live.js)
  if (action === 'ws-token') {
    return res.status(200).json({ wsToken: FINNHUB_KEY });
  }

  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter is required' });
  }

  try {
    const [quoteRes, newsRes] = await Promise.allSettled([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`),
      fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`),
    ]);

    let price = null, change = null, percentChange = null;
    if (quoteRes.status === 'fulfilled' && quoteRes.value.ok) {
      const quote = await quoteRes.value.json();
      price         = quote.c  ?? null;
      change        = quote.d  ?? null;
      percentChange = quote.dp ?? null;
    }

    let news = [];
    if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
      const rawNews = await newsRes.value.json();
      news = Array.isArray(rawNews) ? rawNews.slice(0, 8) : [];
    }

    // Cache for 60 seconds (Finnhub free tier: 60 calls/min)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({ price, change, percentChange, news });

  } catch (err) {
    console.error('[market.js] error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch market data', detail: err.message });
  }
};
