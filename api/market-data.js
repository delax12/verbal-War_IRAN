/**
 * /api/market-data.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────────
 * Unified market data proxy for DELAX GEO-RISK dashboard.
 * Merges Alpha Vantage (equities/forex), FRED (US macro),
 * and World Bank (GDP baselines) into a single endpoint.
 *
 * SETUP — add to Vercel Environment Variables:
 *   ALPHA_VANTAGE_KEY  → alphavantage.co  (free, instant)
 *   FRED_API_KEY       → fred.stlouisfed.org/docs/api (free)
 *   (World Bank needs no key)
 *
 * ENDPOINT:
 *   GET /api/market-data?type=equities
 *   GET /api/market-data?type=forex
 *   GET /api/market-data?type=macro
 *   GET /api/market-data?type=worldbank
 *   GET /api/market-data?type=all   ← dashboard uses this
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'all';
  const avKey   = process.env.ALPHA_VANTAGE_KEY;
  const fredKey = process.env.FRED_API_KEY;

  const results = {};
  const errors  = {};

  // Decide what to fetch
  const fetchEquities  = type === 'all' || type === 'equities';
  const fetchForex     = type === 'all' || type === 'forex';
  const fetchMacro     = type === 'all' || type === 'macro';
  const fetchWorldBank = type === 'all' || type === 'worldbank';

  const tasks = [];

  /* ══ 1. ALPHA VANTAGE — Equity quotes ══
     Symbols: XOM, LMT, RTX, DAL, GLD, SPY, GDX, CCJ
     Free tier: 25 calls/day → we batch with BATCH_STOCK_QUOTES
  ══════════════════════════════════════════ */
  if (fetchEquities && avKey) {
    tasks.push(
      fetchAV(avKey, 'BATCH_STOCK_QUOTES', { symbols: 'XOM,LMT,RTX,DAL,GLD,SPY' })
        .then(data => {
          const quotes = data?.['Stock Quotes'] || [];
          results.equities = quotes.map(q => ({
            symbol:  q['1. symbol'],
            price:   parseFloat(q['2. price']),
            change:  parseFloat(q['4. change']),
            changePct: parseFloat(q['5. change percent']?.replace('%','')),
            volume:  parseInt(q['3. volume']),
          }));
        })
        .catch(e => { errors.equities = e.message; })
    );
  } else if (fetchEquities) {
    errors.equities = 'ALPHA_VANTAGE_KEY not set';
  }

  /* ══ 2. ALPHA VANTAGE — Forex rates ══
     Pairs: USD/EUR, USD/INR, USD/TRY, USD/BRL, USD/EGP, USD/PKR
     Powers the EM FX basket KPI with real data
  ══════════════════════════════════════════ */
  if (fetchForex && avKey) {
    // Fetch one representative pair — USD/EUR as DXY proxy + key EM pairs
    const fxPairs = ['EUR', 'INR', 'TRY', 'BRL'];
    const fxTasks = fxPairs.map(currency =>
      fetchAV(avKey, 'CURRENCY_EXCHANGE_RATE', {
        from_currency: 'USD',
        to_currency:   currency,
      }).then(data => {
        const r = data?.['Realtime Currency Exchange Rate'];
        return r ? {
          pair:  `USD/${currency}`,
          rate:  parseFloat(r['5. Exchange Rate']),
          time:  r['6. Last Refreshed'],
        } : null;
      }).catch(() => null)
    );
    tasks.push(
      Promise.all(fxTasks).then(rates => {
        results.forex = rates.filter(Boolean);
      })
    );
  } else if (fetchForex) {
    errors.forex = 'ALPHA_VANTAGE_KEY not set';
  }

  /* ══ 3. FRED API — US Macro indicators ══
     Series pulled:
       CPIAUCSL  → CPI (Consumer Price Index, All Urban)
       UNRATE    → Unemployment Rate
       FEDFUNDS  → Federal Funds Rate
       T10Y2Y    → 10Y-2Y Yield Curve Spread (recession signal)
       DCOILWTICO→ WTI Crude Oil spot (cross-check vs EIA Brent)
       DHHNGSP   → Natural Gas (Henry Hub)
  ══════════════════════════════════════════ */
  if (fetchMacro && fredKey) {
    const fredSeries = [
      { id: 'CPIAUCSL',   label: 'CPI',           unit: 'Index'   },
      { id: 'UNRATE',     label: 'Unemployment',  unit: '%'       },
      { id: 'FEDFUNDS',   label: 'Fed Rate',       unit: '%'       },
      { id: 'T10Y2Y',     label: 'Yield Curve',    unit: '%'       },
      { id: 'DGS10',      label: 'US 10Y Yield',   unit: '%'       },
      { id: 'DCOILWTICO', label: 'WTI Crude',      unit: '$/bbl'   },
      { id: 'DHHNGSP',    label: 'Natural Gas',    unit: '$/MMBtu' },
    ];

    const fredTasks = fredSeries.map(s =>
      fetchFRED(fredKey, s.id).then(data => {
        const obs = data?.observations;
        if (!obs || !obs.length) return null;
        // Get last 2 valid readings for delta
        const valid = obs.filter(o => o.value !== '.').slice(-2);
        const latest = valid[valid.length - 1];
        const prev   = valid[valid.length - 2];
        const val    = parseFloat(latest?.value);
        const prevVal= parseFloat(prev?.value);
        return {
          id:      s.id,
          label:   s.label,
          unit:    s.unit,
          value:   val,
          prev:    prevVal,
          change:  isNaN(val) || isNaN(prevVal) ? 0 : parseFloat((val - prevVal).toFixed(3)),
          date:    latest?.date,
        };
      }).catch(() => null)
    );

    tasks.push(
      Promise.all(fredTasks).then(macro => {
        results.macro = macro.filter(Boolean);
      })
    );
  } else if (fetchMacro) {
    errors.macro = 'FRED_API_KEY not set — get free key at fred.stlouisfed.org/docs/api';
  }

  /* ══ 4. WORLD BANK — GDP growth baselines ══
     No API key needed. Pulls latest GDP growth %
     for the 8 dashboard regions as real anchors.
     Countries used as region proxies:
       USA → North America
       DEU → Europe
       SAU → Middle East
       CHN → East Asia
       IND → South Asia
       NGA → Africa
       BRA → South America
       AUS → Oceania
  ══════════════════════════════════════════ */
  if (fetchWorldBank) {
    const wbCountries = [
      { code:'US',  label:'North America' },
      { code:'DE',  label:'Europe'        },
      { code:'SA',  label:'Middle East'   },
      { code:'CN',  label:'East Asia'     },
      { code:'IN',  label:'South Asia'    },
      { code:'NG',  label:'Africa'        },
      { code:'BR',  label:'South America' },
      { code:'AU',  label:'Oceania'       },
    ];

    tasks.push(
      Promise.all(wbCountries.map(c =>
        fetchWorldBankGDP(c.code).then(val => ({
          region:  c.label,
          country: c.code,
          gdpGrowth: val,
        })).catch(() => ({ region: c.label, country: c.code, gdpGrowth: null }))
      )).then(wb => { results.worldbank = wb; })
    );
  }

  // Run all fetches in parallel
  await Promise.allSettled(tasks);

  return res.status(200).json({
    results,
    errors,
    fetchedAt: new Date().toISOString(),
    keysPresent: {
      alphaVantage: !!avKey,
      fred:         !!fredKey,
      worldBank:    true, // no key needed
    },
  });
};

/* ══ Alpha Vantage helper ══ */
async function fetchAV(key, func, params = {}) {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', func);
  url.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Alpha Vantage HTTP ${r.status}`);
  const data = await r.json();
  if (data?.Note?.includes('call frequency')) throw new Error('Alpha Vantage rate limit — 25 calls/day on free tier');
  if (data?.['Error Message']) throw new Error(data['Error Message']);
  return data;
}

/* ══ FRED helper ══ */
async function fetchFRED(key, seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&limit=10&sort_order=desc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const data = await r.json();
  if (data?.error_code) throw new Error(data.error_message || 'FRED error');
  // Reverse so latest is last
  if (data.observations) data.observations.reverse();
  return data;
}

/* ══ World Bank helper ══ */
async function fetchWorldBankGDP(countryCode) {
  // NY.GDP.MKTP.KD.ZG = GDP growth (annual %)
  const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=2&per_page=2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`World Bank HTTP ${r.status}`);
  const data = await r.json();
  const obs = data?.[1];
  if (!obs || !obs.length) return null;
  const latest = obs.find(o => o.value !== null);
  return latest ? parseFloat(latest.value.toFixed(2)) : null;
}
