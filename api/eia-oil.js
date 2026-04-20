/**
 * /api/eia-oil.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * Secure proxy for EIA v2 Petroleum Spot Prices API.
 * Keeps EIA_API_KEY server-side — never exposed to the browser.
 *
 * SETUP (one-time in Vercel Dashboard):
 *   1. vercel.com → Your Project → Settings → Environment Variables
 *   2. Add:  Name = EIA_API_KEY  |  Value = <your key from eia.gov/opendata>
 *   3. Check: ✅ Production  ✅ Preview  ✅ Development
 *   4. Save → Deployments → Redeploy
 *
 * ENDPOINT called from index.html:
 *   GET /api/eia-oil
 *   Returns JSON: { price, date, seriesName, unit, trend7d, history[], fetchedAt }
 *
 * CACHING:
 *   CDN edge cache: 6 hours  (EIA publishes once daily ~4pm ET)
 *   stale-while-revalidate: 1 hour
 */

module.exports = async function handler(req, res) {

  // ── Only allow GET ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Read key from Vercel environment — never from client ──
  const apiKey = process.env.EIA_API_KEY;

  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store'); // Fix 1.2: don't cache errors
    return res.status(500).json({
      error: 'EIA_API_KEY environment variable is not set.',
      fix:   'Vercel Dashboard → Your Project → Settings → Environment Variables → Add EIA_API_KEY',
      docs:  'https://vercel.com/docs/projects/environment-variables'
    });
  }

  /**
   * EIA v2 API — Petroleum Spot Prices
   * Series : RBRTE = Europe Brent Spot Price FOB (Dollars per Barrel, daily)
   * Docs   : https://www.eia.gov/opendata/browser/petroleum/pri/spt
   */
  const EIA_URL =
    'https://api.eia.gov/v2/petroleum/pri/spt/data/' +
    '?api_key=' + encodeURIComponent(apiKey) +
    '&frequency=daily' +
    '&data[0]=value' +
    '&facets[series][]=RBRTE' +
    '&sort[0][column]=period' +
    '&sort[0][direction]=desc' +
    '&length=30';   // last 30 trading days for trend + sparkline

  try {
    const upstream = await fetch(EIA_URL, {
      headers: { 'Accept': 'application/json' }
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      res.setHeader('Cache-Control', 'no-store'); // Fix 1.2
      return res.status(upstream.status).json({
        error:  'EIA API returned an error',
        status: upstream.status,
        detail: body.slice(0, 400)
      });
    }

    const json = await upstream.json();
    const rows = json && json.response && json.response.data;

    if (!rows || rows.length === 0) {
      res.setHeader('Cache-Control', 'no-store'); // Fix 1.2
      return res.status(502).json({ error: 'EIA returned an empty dataset' });
    }

    // ── Latest available trading day ──
    const latest = rows[0];
    const price  = parseFloat(latest.value);

    if (isNaN(price)) {
      res.setHeader('Cache-Control', 'no-store'); // Fix 1.2
      return res.status(502).json({
        error: 'EIA price value is not a number',
        raw:   latest
      });
    }

    // ── 7-day price trend ──
    const weekAgo      = rows[Math.min(6, rows.length - 1)];
    const weekAgoPrice = parseFloat(weekAgo && weekAgo.value ? weekAgo.value : price);
    const trend7d      = parseFloat((((price - weekAgoPrice) / weekAgoPrice) * 100).toFixed(2));

    // ── 30-day history array for optional sparkline use ──
    const history = rows
      .map(function(r) {
        return { date: r.period, price: parseFloat(r.value) };
      })
      .filter(function(r) { return !isNaN(r.price); });

    const payload = {
      price:      price,
      date:       latest.period,               // "YYYY-MM-DD"
      series:     'RBRTE',
      seriesName: 'Europe Brent Spot Price FOB',
      unit:       'Dollars per Barrel',
      trend7d:    trend7d,                     // positive = rising, negative = falling
      history:    history,                     // [{date, price}, ...] newest first
      fetchedAt:  new Date().toISOString()
    };

    // ── Cache at CDN edge for 6 hours; serve stale for 1hr while revalidating ──
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[eia-oil] fetch error:', err.message);
    res.setHeader('Cache-Control', 'no-store'); // Fix 1.2
    return res.status(500).json({
      error:  'Upstream fetch to EIA failed',
      detail: err.message
    });
  }
};
