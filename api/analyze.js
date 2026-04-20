/**
 * /api/analyze.js — Vercel Serverless Function (CommonJS)
 * Multi-provider AI narrative engine for DELAX GEO-RISK dashboard.
 * Auto-detects: GEMINI_API_KEY (free) → GROQ_API_KEY (free) → ANTHROPIC_API_KEY (paid)
 *
 * FIX NOTES (v3):
 *  • GROUP 2: Moved from project root → /api/ so Vercel executes it (was a static file).
 *  • FIX 4.1: Gemini model updated gemini-1.5-flash → gemini-2.0-flash (faster, higher limits).
 *  • FIX 4.2: stockinsights JSON parse now strips leading commentary before first '{'.
 *             Gemini sometimes prepends "Here is the analysis:\n" before the JSON block.
 *  • FIX 4.3: Each provider call wrapped in 8-second AbortController timeout.
 *             Prevents Vercel's 10s function limit from killing with an opaque 504.
 *
 * type:'heatmap'      → 3-paragraph regional stress narrative
 * type:'kpi'          → 4-section click-to-explain indicator analysis
 * type:'newssummary'  → 1-sentence Bloomberg-style alert from top headlines
 * type:'stockinsights'→ JSON stock analysis for country popup
 */
'use strict';

const AI_TIMEOUT_MS = 8000; // 8s — leaves 2s buffer before Vercel's 10s limit

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed — use POST' });

  /* ── Provider auto-detection ── */
  const geminiKey    = process.env.GEMINI_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider     = geminiKey ? 'gemini' : groqKey ? 'groq' : anthropicKey ? 'anthropic' : null;
  const apiKey       = geminiKey || groqKey || anthropicKey;

  if (!provider) {
    return res.status(500).json({
      error:   'No AI API key configured in Vercel environment variables.',
      options: [
        'GEMINI_API_KEY (FREE) — aistudio.google.com',
        'GROQ_API_KEY (FREE)   — console.groq.com',
        'ANTHROPIC_API_KEY ($) — console.anthropic.com',
      ],
    });
  }

  const {
    type, scenario = 'baseline',
    kpiId, kpiLabel, kpiValue,
    oilPrice = 121, cpi = '+3.8%', gdp = '-1.9%',
    liveDate = new Date().toISOString().slice(0,10),
    headlines = [],
    countryName, stocks, stressIndex, countryData,
  } = req.body || {};

  if (!type) return res.status(400).json({ error: 'type is required: heatmap, kpi, newssummary, or stockinsights' });

  /* ════════════ HEATMAP NARRATIVE ════════════ */
  if (type === 'heatmap') {
    const scenDesc = {
      baseline:    `Baseline (P=50%): 24-month conflict, partial Hormuz disruption, Brent $${oilPrice}/bbl`,
      optimistic:  `Optimistic (P=22%): Ceasefire Month 10, Hormuz reopens, Brent $${oilPrice}/bbl`,
      pessimistic: `Pessimistic (P=28%): Full Hormuz closure 6+ months, regional expansion, Brent $${oilPrice}/bbl`,
    }[scenario] || `Scenario: ${scenario}, Brent $${oilPrice}/bbl`;

    const prompt = `You are DELAX GEO-RISK, a geopolitical economic analyst writing a narrative for an investor dashboard heatmap.

ACTIVE SCENARIO: ${scenDesc}
LIVE DATA: Brent $${oilPrice}/bbl | CPI add: ${cpi} | GDP: ${gdp} | Date: ${liveDate}

HEATMAP STRESS SCORES (0-10 scale, Year 1 → Year 10):
Middle East: 9.1→1.7 | Africa: 6.8→1.1 | South Asia: 5.4→0.6
Europe: 3.8→0.3 | East Asia: 2.8→0.2 | South America: 2.9→0.3
North America: 2.1→0.2 | Oceania: 1.4→0.1

Write exactly 3 paragraphs. No headers. No bullet points. Plain prose only.

Paragraph 1 — REGIONAL EPICENTER: Which regions are hardest hit, their exact stress scores, and the specific reason under this scenario.
Paragraph 2 — CASCADING EFFECTS: How high-stress regions create spillovers via food prices, energy supply, migration, and trade routes.
Paragraph 3 — OUTLOOK AND INVESTOR SIGNAL: How stress evolves from Year 1 to Year 10, and one specific investor action with a ticker.

55-70 words per paragraph. Data-driven. Use specific numbers. Begin immediately with Paragraph 1 — no intro line.`;

    const result = await route(provider, apiKey, prompt, 520);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
    return res.status(200).json({ narrative: result.text, provider, model: result.model, generatedAt: new Date().toISOString() });
  }

  /* ════════════ KPI NARRATIVE ════════════ */
  if (type === 'kpi') {
    if (!kpiId) return res.status(400).json({ error: 'kpiId required when type is kpi' });

    const meta = {
      oil:  { full:'Brent Crude Oil Projected Peak',        pre:'$78/bbl',   drivers:'Hormuz closure risk, OPEC spare capacity, SPR drawdown, US shale 6-9 month ramp lag' },
      cpi:  { full:'Global CPI Inflation Addition Year 1',  pre:'0%',        drivers:'Oil pass-through +$10/bbl equals +0.3% CPI, fertilizer cost surge, shipping surcharges, EM currency depreciation' },
      gdp:  { full:'Global GDP Loss Year 1',                pre:'0%',        drivers:'Consumer confidence collapse, investment freeze, trade volume decline, defense crowding out private investment' },
      ship: { full:'Shipping Cost Index vs Pre-Conflict',   pre:'100 index', drivers:'Hormuz/Suez rerouting via Cape of Good Hope adding 15 days, war-risk insurance premiums, port congestion' },
      def:  { full:'Global Defense Spending Increase Yr1',  pre:'$0 extra',  drivers:'NATO emergency pledges, Gulf state mobilization, Israeli and Indian procurement surge, Taiwan alert' },
      fao:  { full:'FAO Food Price Index Increase',         pre:'0%',        drivers:'Gas-based fertilizer spike, fuel input costs for farming, shipping cost pass-through, MENA supply shock' },
      fx:   { full:'Emerging Market Currency Basket vs USD',pre:'0%',        drivers:'Flight-to-safety USD inflows, EM energy import bills priced in USD, capital outflows, EM central bank rate hikes' },
      dur:  { full:'Estimated Conflict Duration',           pre:'N/A',       drivers:'Historical analogs Gulf War 7 months Russia-Ukraine 30 months, Iranian proxy network complexity, diplomatic channels' },
    }[kpiId] || { full: kpiLabel || kpiId, pre:'N/A', drivers:'Multiple geopolitical factors' };

    const scenLabel = { baseline:'Baseline P=50%', optimistic:'Optimistic P=22%', pessimistic:'Pessimistic P=28%' }[scenario] || 'Baseline';

    const prompt = `You are DELAX GEO-RISK explaining a market indicator to an investor who just clicked it on a financial dashboard.

INDICATOR: ${meta.full}
CURRENT VALUE: ${kpiValue || 'N/A'} | PRE-CONFLICT BASELINE: ${meta.pre}
SCENARIO: ${scenLabel} | Brent: $${oilPrice}/bbl | CPI: ${cpi} | GDP: ${gdp}
KEY DRIVERS: ${meta.drivers}

Write exactly 4 sections. Begin each with the label in bold followed by a colon. No other markdown or bullet points.

**What it is:** One plain-English sentence that a retiree with no finance background can understand.
**Why it is at ${kpiValue || 'this level'}:** 2 to 3 sentences explaining the specific conflict-driven forces under the ${scenario} scenario. Use exact figures.
**Who feels it most:** 2 sentences naming specific countries or population groups and explaining why they are hit hardest.
**Investor action:** One direct sentence recommending what to buy, avoid, or hedge, with at least one specific ticker or asset class.

Total 120 to 140 words. Be precise and actionable.`;

    const result = await route(provider, apiKey, prompt, 400);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
    return res.status(200).json({ narrative: result.text, provider, model: result.model, generatedAt: new Date().toISOString() });
  }

  /* ════════════ NEWS SUMMARY ════════════ */
  if (type === 'newssummary') {
    if (!headlines.length) return res.status(400).json({ error: 'headlines array required' });

    if (headlines.length === 1 && headlines[0].length > 200) {
      const result = await route(provider, apiKey, headlines[0], 400);
      if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
      return res.status(200).json({ summary: result.text, provider, model: result.model, generatedAt: new Date().toISOString() });
    }

    const HOT = ['iran','hormuz','oil','brent','opec','war','strike','missile','sanctions',
      'ceasefire','nuclear','attack','crisis','emergency','surge','fed','rate','inflation',
      'recession','crash','spike','collapse','record','explosion','conflict'];

    const scored = headlines.map(h => {
      const l = h.toLowerCase();
      const s = HOT.reduce((a, k) => a + (l.includes(k) ? 2 : 0), 0)
              + (l.includes('iran') || l.includes('hormuz') ? 5 : 0);
      return { h, s };
    }).sort((a, b) => b.s - a.s);

    const top5    = scored.slice(0, 5).map(x => x.h);
    const hottest = scored[0]?.h || headlines[0];

    const prompt = `You are a Bloomberg terminal intelligence system for the DELAX GEO-RISK dashboard.

SCENARIO: ${scenario} | Brent: $${oilPrice}/bbl | ${new Date().toISOString().slice(0,10)}

TOP HEADLINES:
${top5.map((h, i) => `${i+1}. ${h}`).join('\n')}

HOTTEST: "${hottest}"

Write EXACTLY ONE sentence (max 28 words):
- Start with BREAKING, ALERT, or WATCH
- Name the key development
- State direct market impact (oil price move, specific asset, or region)
- Sound like a live terminal alert

Output the sentence only. No quotes. No explanation.

Examples:
ALERT: Iran drone strikes Red Sea tanker — Brent +$11/bbl · Shipping insurance surging
BREAKING: Ceasefire talks collapse in Geneva — Oil futures +$8 · EM FX selloff accelerating
WATCH: Saudi spare capacity activated — Brent easing $4 from peak · Supply gap narrowing`;

    const result = await route(provider, apiKey, prompt, 80);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });

    return res.status(200).json({
      summary:     result.text.trim(),
      hottest,
      top5,
      provider,
      model:       result.model,
      generatedAt: new Date().toISOString(),
    });
  }

  /* ════════════ STOCK INSIGHTS ════════════ */
  if (type === 'stockinsights') {
    const country  = countryName || 'Unknown';
    const stockList= (stocks || []).slice(0, 6).map(s => `${s[0]} (${s[1]})`).join(', ') || 'XOM, GLD, LMT, RTX';
    const stress   = stressIndex || 'N/A';
    const cData    = countryData || {};

    const prompt = `You are a sell-side equity analyst at a global investment bank covering the Iran War 2026 scenario.

COUNTRY: ${country}
SCENARIO: ${scenario.toUpperCase()} | Brent: $${oilPrice}/bbl
Stress Index: ${stress}/10 | CPI: ${cData.cpi || 'N/A'}% | GDP: ${cData.gdp || 'N/A'}%
Oil dependency: ${cData.oilDep || 'N/A'}% | FX Vol: ${cData.fxVol || 'N/A'}%

RELEVANT STOCKS: ${stockList}

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "theme": "2-sentence macro theme for ${country} in this scenario",
  "stocks": [
    {"sym":"TICKER","signal":"BUY","reason":"one sentence quantitative rationale"},
    {"sym":"TICKER","signal":"HOLD","reason":"one sentence quantitative rationale"},
    {"sym":"TICKER","signal":"SELL","reason":"one sentence quantitative rationale"}
  ],
  "risk": "one sentence key risk to this view"
}

Include 3-4 stocks. Keep total under 140 words. JSON only.`;

    const result = await route(provider, apiKey, prompt, 450);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });

    /* FIX 4.2: Strip any leading commentary before the first '{'.
       Gemini sometimes returns "Here is the analysis:\n{...}" or similar.
       We find the first '{' and trim everything before it, then strip fences. */
    let parsed = null;
    let raw = result.text.trim().replace(/```json\n?|```/g, '').trim();
    const firstBrace = raw.indexOf('{');
    if (firstBrace > 0) raw = raw.slice(firstBrace);
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = { theme: raw.slice(0, 200), stocks: [], risk: 'Parse error — see theme for analysis.' };
    }

    return res.status(200).json({
      ...parsed,
      provider,
      model:       result.model,
      generatedAt: new Date().toISOString(),
    });
  }

  return res.status(400).json({ error: 'Unknown type. Use heatmap, kpi, newssummary, or stockinsights.' });
};

/* ════════════════════════════════════════════════════
   PROVIDER ROUTER — FIX 4.3: 8-second timeout on all calls
   ════════════════════════════════════════════════════ */
async function route(provider, apiKey, prompt, maxTokens) {
  if (provider === 'gemini')    return callGemini(apiKey, prompt, maxTokens);
  if (provider === 'groq')      return callGroq(apiKey, prompt, maxTokens);
  if (provider === 'anthropic') return callAnthropic(apiKey, prompt, maxTokens);
  return { error: 'Unknown provider', status: 500 };
}

function makeAbortSignal() {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return controller.signal;
}

/* MODEL: gemini-1.5-flash — the correct free-tier model.
   gemini-2.0-flash has limit:0 on free tier (pay-as-you-go only).
   gemini-1.5-flash: 15 RPM, 1M tokens/day on free tier. */
async function callGemini(apiKey, prompt, maxTokens) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method:  'POST',
      signal:  makeAbortSignal(),
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    });
    let b; try { b = await r.json(); } catch(_) { return { error: 'Gemini non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Gemini HTTP ${r.status}`, status: r.status };
    const text = b?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return { error: 'Gemini returned empty text', status: 502 };
    return { text, model: 'gemini-1.5-flash' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Gemini request timed out after 8s', status: 504 };
    return { error: `Gemini network: ${e.message}`, status: 500 };
  }
}

async function callGroq(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      signal:  makeAbortSignal(),
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  maxTokens,
        temperature: 0.7,
        messages:    [{ role: 'user', content: prompt }],
      }),
    });
    let b; try { b = await r.json(); } catch(_) { return { error: 'Groq non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Groq HTTP ${r.status}`, status: r.status };
    const text = b?.choices?.[0]?.message?.content || '';
    if (!text) return { error: 'Groq returned empty text', status: 502 };
    return { text, model: 'llama-3.3-70b-versatile' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Groq request timed out after 8s', status: 504 };
    return { error: `Groq network: ${e.message}`, status: 500 };
  }
}

async function callAnthropic(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      signal:  makeAbortSignal(),
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    let b; try { b = await r.json(); } catch(_) { return { error: 'Anthropic non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Anthropic HTTP ${r.status}`, status: r.status };
    const text = (b.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    if (!text) return { error: 'Anthropic returned empty content', status: 502 };
    return { text, model: b.model || 'claude-haiku' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Anthropic request timed out after 8s', status: 504 };
    return { error: `Anthropic network: ${e.message}`, status: 500 };
  }
}
