// api/eia-oil.js — DELAX GeoRisk v2.4
// PRIMARY SOURCE: Yahoo Finance BZ=F (no API key, live intraday)
// FALLBACK CHAIN: Yahoo → AlphaVantage → Finnhub → EIA → hardcoded floor
// Returns full oil data object consumed by ALL dashboard surfaces

export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET’);
// 2-min edge cache — aggressive enough for live feel, gentle on rate limits
res.setHeader(‘Cache-Control’, ‘s-maxage=120, stale-while-revalidate=60’);

const ANCHOR       = 78;    // pre-conflict Brent baseline $/bbl
const SCENARIO_MULT = 1.90; // baseline peak multiplier

let price      = null;
let prevClose  = null;
let change     = null;
let changePct  = null;
let dayHigh    = null;
let dayLow     = null;
let volume     = null;
let marketTime = null;
let source     = ‘fallback’;

// ── SOURCE 0: Yahoo Finance — BZ=F (PRIMARY, no key needed) ────────────────
// Two endpoint attempts: v8/finance/chart (most reliable) then v7/finance/quote
const yahooHeaders = {
‘User-Agent’: ‘Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36’,
‘Accept’: ‘application/json’,
};

// Attempt A: v8 chart endpoint (returns meta + OHLCV)
if (!price) {
try {
const url = ‘https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=1m&range=1d’;
const r = await fetch(url, {
headers: yahooHeaders,
signal: AbortSignal.timeout(5000),
});
if (r.ok) {
const j = await r.json();
const meta = j?.chart?.result?.[0]?.meta;
if (meta?.regularMarketPrice && meta.regularMarketPrice > 20) {
price     = parseFloat(meta.regularMarketPrice.toFixed(2));
prevClose = parseFloat((meta.chartPreviousClose || meta.previousClose || price).toFixed(2));
dayHigh   = meta.regularMarketDayHigh ? parseFloat(meta.regularMarketDayHigh.toFixed(2)) : null;
dayLow    = meta.regularMarketDayLow  ? parseFloat(meta.regularMarketDayLow.toFixed(2))  : null;
volume    = meta.regularMarketVolume  || null;
marketTime = meta.regularMarketTime
? new Date(meta.regularMarketTime * 1000).toISOString()
: new Date().toISOString();
change    = parseFloat((price - prevClose).toFixed(2));
changePct = parseFloat(((change / prevClose) * 100).toFixed(2));
source    = ‘Yahoo-v8’;
}
}
} catch (_) {}
}

// Attempt B: v7 quote endpoint (backup Yahoo path)
if (!price) {
try {
const url = ‘https://query2.finance.yahoo.com/v7/finance/quote?symbols=BZ%3DF&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketTime’;
const r = await fetch(url, {
headers: yahooHeaders,
signal: AbortSignal.timeout(5000),
});
if (r.ok) {
const j = await r.json();
const q = j?.quoteResponse?.result?.[0];
if (q?.regularMarketPrice && q.regularMarketPrice > 20) {
price     = parseFloat(q.regularMarketPrice.toFixed(2));
prevClose = parseFloat((q.regularMarketPreviousClose || price).toFixed(2));
dayHigh   = q.regularMarketDayHigh  ? parseFloat(q.regularMarketDayHigh.toFixed(2))  : null;
dayLow    = q.regularMarketDayLow   ? parseFloat(q.regularMarketDayLow.toFixed(2))   : null;
volume    = q.regularMarketVolume   || null;
marketTime = q.regularMarketTime
? new Date(q.regularMarketTime * 1000).toISOString()
: new Date().toISOString();
change    = parseFloat((price - prevClose).toFixed(2));
changePct = parseFloat(((change / prevClose) * 100).toFixed(2));
source    = ‘Yahoo-v7’;
}
}
} catch (_) {}
}

// ── SOURCE 1: AlphaVantage (BZ=F global quote) ──────────────────────────────
if (!price) {
try {
const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
if (AV_KEY) {
const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=BZ%3DF&apikey=${AV_KEY}`;
const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
if (r.ok) {
const j = await r.json();
const q = j?.[‘Global Quote’];
if (q?.[‘05. price’] && parseFloat(q[‘05. price’]) > 20) {
price     = parseFloat(parseFloat(q[‘05. price’]).toFixed(2));
prevClose = parseFloat(parseFloat(q[‘08. previous close’] || price).toFixed(2));
dayHigh   = q[‘03. high’] ? parseFloat(parseFloat(q[‘03. high’]).toFixed(2)) : null;
dayLow    = q[‘04. low’]  ? parseFloat(parseFloat(q[‘04. low’]).toFixed(2))  : null;
change    = parseFloat(parseFloat(q[‘09. change’] || 0).toFixed(2));
changePct = parseFloat((q[‘10. change percent’] || ‘0’).replace(’%’, ‘’));
source    = ‘AlphaVantage’;
marketTime = new Date().toISOString();
}
}
}
} catch (_) {}
}

// ── SOURCE 2: Finnhub (OANDA:BCOUSD) ────────────────────────────────────────
if (!price) {
try {
const FH_KEY = process.env.FINNHUB_API_KEY;
if (FH_KEY) {
const url = `https://finnhub.io/api/v1/quote?symbol=OANDA%3ABCOUSD&token=${FH_KEY}`;
const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
if (r.ok) {
const j = await r.json();
if (j?.c && j.c > 20) {
price     = parseFloat(j.c.toFixed(2));
prevClose = parseFloat((j.pc || price).toFixed(2));
dayHigh   = j.h ? parseFloat(j.h.toFixed(2)) : null;
dayLow    = j.l ? parseFloat(j.l.toFixed(2)) : null;
change    = parseFloat((j.c - j.pc).toFixed(2));
changePct = parseFloat((((j.c - j.pc) / j.pc) * 100).toFixed(2));
source    = ‘Finnhub’;
marketTime = j.t ? new Date(j.t * 1000).toISOString() : new Date().toISOString();
}
}
}
} catch (_) {}
}

// ── SOURCE 3: EIA RBRTE (daily close — 1-day lag but official) ──────────────
if (!price) {
try {
const EIA_KEY = process.env.EIA_API_KEY;
if (EIA_KEY) {
const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_KEY}` +
`&frequency=daily&data[0]=value&facets[series][]=RBRTE` +
`&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=2`;
const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
if (r.ok) {
const j = await r.json();
const rows = j?.response?.data;
if (rows?.length >= 1 && parseFloat(rows[0].value) > 20) {
price     = parseFloat(parseFloat(rows[0].value).toFixed(2));
prevClose = rows.length >= 2 ? parseFloat(parseFloat(rows[1].value).toFixed(2)) : price;
change    = parseFloat((price - prevClose).toFixed(2));
changePct = parseFloat(((change / prevClose) * 100).toFixed(2));
source    = ‘EIA-RBRTE’;
marketTime = new Date().toISOString();
}
}
}
} catch (_) {}
}

// ── HARDCODED FLOOR — updated Apr 14 2026 ───────────────────────────────────
if (!price) {
price     = 98.26;   // BZ=F close Apr 14 2026 — update on each push
prevClose = 95.20;
change    = 3.06;
changePct = 3.21;
dayHigh   = 103.40;
dayLow    = 94.80;
source    = ‘cached-floor’;
marketTime = new Date().toISOString();
}

// ── SANITIZE all numbers — prevents concatenation / NaN bugs ────────────────
const safe = (n, d = 2) => (typeof n === ‘number’ && !isNaN(n)) ? parseFloat(n.toFixed(d)) : null;
price     = safe(price)     ?? 98.26;
prevClose = safe(prevClose) ?? price;
change    = safe(change)    ?? 0;
changePct = safe(changePct) ?? 0;

// ── DERIVED MODEL METRICS — all anchored to live Yahoo price ────────────────
const conflictDelta    = safe(price - ANCHOR);
const conflictDeltaPct = safe(((price - ANCHOR) / ANCHOR) * 100, 1);

// CPI model: +$10/bbl above anchor → +0.3% CPI
const cpiAdd = safe(Math.max(0, (conflictDelta / 10) * 0.3));

// GDP model: −0.5% per $30/bbl above anchor, capped at −3.5%
const gdpLoss = safe(Math.min(Math.max(0, (conflictDelta / 30) * 0.5), 3.5));

// Shipping: scales with oil shock %, anchored to +310% at full scenario
const shippingIndex = Math.round(100 + Math.max(0, (conflictDeltaPct / 100) * 310));

// Peak estimate: scenario multiplier applied to live price
const peakEstimate = safe(Math.max(price * SCENARIO_MULT, price * 1.20), 0);

// Food price: scales with conflict delta (capped at +35%)
const foodPricePct = safe(Math.min((conflictDelta / (ANCHOR * 0.9)) * 27, 35), 1);

// USD/EM FX: scales with oil shock
const emFxPct = safe(Math.min(-(conflictDeltaPct / 100) * 14, 0), 1);

// Defense spend delta ($B) — scales modestly with conflict intensity
const defenseSpendB = safe(Math.max(0, 300 + (conflictDeltaPct / 100) * 380), 0);

return res.status(200).json({
// ── PRICE DATA ─────────────────────────────────────────────────
price,
prevClose,
change,
changePct,
dayHigh,
dayLow,
volume,
source,
timestamp:  new Date().toISOString(),
marketTime,
symbol:     ‘BZ=F’,
currency:   ‘USD’,
unit:       ‘per barrel’,

```
// ── CONFLICT CONTEXT ───────────────────────────────────────────
anchor:            ANCHOR,
conflictDelta,
conflictDeltaPct,

// ── DERIVED MODEL METRICS (drive ALL KPI tiles) ────────────────
derived: {
  cpiAdd,          // Global CPI Yr1 addition (%)
  gdpLoss,         // Global GDP Yr1 loss (%)
  shippingIndex,   // Shipping disruption index (100 = pre-conflict)
  peakEstimate,    // Scenario peak oil price ($/bbl)
  foodPricePct,    // FAO food price increase (%)
  emFxPct,         // EM FX basket vs USD (%)
  defenseSpendB,   // Global defense spend delta ($B)
},
```

});
}
