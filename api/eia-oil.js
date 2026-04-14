// api/eia-oil.js — DELAX GeoRisk · Live Brent Crude Proxy
// Multi-source fallback: EIA (primary) → AlphaVantage → Finnhub → hardcoded floor
// Returns: { price, change, changePct, source, timestamp, anchor, conflictDelta, derived }

export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=300, stale-while-revalidate=60’); // 5-min Vercel edge cache

const ANCHOR = 78;          // pre-conflict baseline $/bbl
const SCENARIO_MULT = 1.90; // baseline peak multiplier (148/78)

let price = null;
let change = null;
let changePct = null;
let source = ‘fallback’;

// ── SOURCE 1: EIA (RBRTE series — Brent daily close, 1-day lag) ─────────────
try {
const EIA_KEY = process.env.EIA_API_KEY;
if (EIA_KEY) {
const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_KEY}` +
`&frequency=daily&data[0]=value&facets[series][]=RBRTE` +
`&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=2`;
const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
const j = await r.json();
const rows = j?.response?.data;
if (rows && rows.length >= 1) {
price = parseFloat(rows[0].value);
if (rows.length >= 2) {
const prev = parseFloat(rows[1].value);
change = parseFloat((price - prev).toFixed(2));
changePct = parseFloat(((change / prev) * 100).toFixed(2));
}
source = ‘EIA’;
}
}
} catch (_) { /* fall through */ }

// ── SOURCE 2: AlphaVantage (BZ=F Brent intraday quote) ──────────────────────
if (!price) {
try {
const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
if (AV_KEY) {
const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=BZ%3DF&apikey=${AV_KEY}`;
const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
const j = await r.json();
const q = j?.[‘Global Quote’];
if (q && q[‘05. price’]) {
price = parseFloat(q[‘05. price’]);
change = parseFloat(q[‘09. change’] || 0);
changePct = parseFloat((q[‘10. change percent’] || ‘0’).replace(’%’, ‘’));
source = ‘AlphaVantage’;
}
}
} catch (_) { /* fall through */ }
}

// ── SOURCE 3: Finnhub (quote for OANDA:BCOUSD) ───────────────────────────────
if (!price) {
try {
const FH_KEY = process.env.FINNHUB_API_KEY;
if (FH_KEY) {
const url = `https://finnhub.io/api/v1/quote?symbol=OANDA%3ABCOUSD&token=${FH_KEY}`;
const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
const j = await r.json();
if (j?.c && j.c > 0) {
price = parseFloat(j.c.toFixed(2));
change = parseFloat((j.c - j.pc).toFixed(2));
changePct = parseFloat((((j.c - j.pc) / j.pc) * 100).toFixed(2));
source = ‘Finnhub’;
}
}
} catch (_) { /* fall through */ }
}

// ── HARDCODED FLOOR (last known war-era price — update periodically) ─────────
if (!price) {
price = 112.40;
change = 1.85;
changePct = 1.67;
source = ‘cached’;
}

// ── DERIVED METRICS (all scale off live price vs anchor) ─────────────────────
const conflictDelta = parseFloat((price - ANCHOR).toFixed(2));
const conflictDeltaPct = parseFloat(((conflictDelta / ANCHOR) * 100).toFixed(1));

// CPI model: +$10/bbl → +0.3% CPI (import-heavy economies)
const cpiAdd = parseFloat(((conflictDelta / 10) * 0.3).toFixed(2));

// GDP model: −0.5% per $30/bbl above anchor (rough IMF calibration)
const gdpLoss = parseFloat(Math.min((conflictDelta / 30) * 0.5, 3.5).toFixed(2));

// Shipping index: scales with oil shock severity
const shippingIndex = Math.round(100 + (conflictDeltaPct / 100) * 310);

// Peak price estimate (scenario builder baseline)
const peakEstimate = parseFloat(Math.max(price * SCENARIO_MULT, price * 1.2).toFixed(2));

// Food price proxy: +27% at full conflict scenario, scales with delta
const foodPricePct = parseFloat(((conflictDelta / (ANCHOR * 0.90)) * 27).toFixed(1));

return res.status(200).json({
price,
change,
changePct,
source,
timestamp: new Date().toISOString(),
anchor: ANCHOR,
conflictDelta,
conflictDeltaPct,
derived: {
cpiAdd,
gdpLoss,
shippingIndex,
peakEstimate,
foodPricePct: Math.min(foodPricePct, 35),
}
});
}
