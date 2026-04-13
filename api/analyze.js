/**
 * /api/analyze.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * Claude AI narrative engine for the DELAX GEO-RISK dashboard.
 *
 * FIXED v2:
 *   - Correct model string: claude-haiku-4-5-20251001
 *   - CORS headers added (required for browser → Vercel fetch)
 *   - Detailed error passthrough so UI shows exact failure reason
 *   - Handles Anthropic JSON error bodies properly
 */

module.exports = async function handler(req, res) {

  /* ── CORS headers — MUST be set before any return ── */
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed — use POST' });

  /* ── API Key ── */
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not found in Vercel environment variables.',
      fix:   'Vercel Dashboard → Your Project → Settings → Environment Variables → Add ANTHROPIC_API_KEY → Redeploy',
    });
  }

  const {
    type, scenario = 'baseline',
    kpiId, kpiLabel, kpiValue,
    oilPrice = 121, cpi = '+3.8%', gdp = '-1.9%',
    liveDate,
  } = req.body || {};

  if (!type) return res.status(400).json({ error: 'type is required: heatmap or kpi' });

  /* ════════════ HEATMAP NARRATIVE ════════════ */
  if (type === 'heatmap') {
    const scenarioLabel = {
      baseline:    `Baseline (P=50%): 24-month conflict, partial Hormuz disruption, Brent $${oilPrice}/bbl`,
      optimistic:  `Optimistic (P=22%): Ceasefire Month 10, Hormuz reopens, Brent $${oilPrice}/bbl`,
      pessimistic: `Pessimistic (P=28%): Full Hormuz closure 6+ months, regional expansion, Brent $${oilPrice}/bbl`,
    }[scenario] || `Baseline: 24-month conflict, Brent $${oilPrice}/bbl`;

    const system = `You are DELAX GEO-RISK, a geopolitical economic analyst writing a dashboard narrative for investors.

ACTIVE SCENARIO: ${scenarioLabel}
LIVE DATA: Brent $${oilPrice}/bbl | CPI add: ${cpi} | GDP: ${gdp} | Date: ${liveDate || 'April 2026'}

HEATMAP STRESS VALUES (0-10 scale, Year 1 → Year 10):
Middle East: 9.1→1.7 | Africa: 6.8→1.1 | South Asia: 5.4→0.6
Europe: 3.8→0.3 | East Asia: 2.8→0.2 | South America: 2.9→0.3
North America: 2.1→0.2 | Oceania: 1.4→0.1

Write exactly 3 paragraphs. No headers. No bullets. Plain prose only.

Para 1 — REGIONAL EPICENTER: Hardest-hit regions, exact stress scores, specific reasons under this scenario.
Para 2 — CASCADING EFFECTS: How high-stress regions spill into lower-stress ones via food, energy, migration, trade.
Para 3 — OUTLOOK & INVESTOR SIGNAL: How stress evolves Year 1→10, and one specific investor action with a ticker or asset.

55-70 words per paragraph. Data-driven, specific numbers. Begin paragraph 1 immediately.`;

    return callClaude(apiKey, system, 'Generate the heatmap narrative.', 500, res);
  }

  /* ════════════ KPI CLICK NARRATIVE ════════════ */
  if (type === 'kpi') {
    if (!kpiId) return res.status(400).json({ error: 'kpiId required when type is kpi' });

    const kpiMeta = {
      oil:  { full:'Brent Crude Oil (Projected Peak)',       pre:'$78/bbl',   drivers:'Hormuz closure risk, OPEC spare capacity limits, SPR drawdown timing, US shale 6-9 month ramp lag' },
      cpi:  { full:'Global CPI Inflation Addition (Year 1)', pre:'0% add',    drivers:'Oil pass-through (+$10/bbl = +0.3% CPI), fertilizer cost surge, shipping surcharges, EM currency depreciation' },
      gdp:  { full:'Global GDP Loss (Year 1)',               pre:'0%',        drivers:'Consumer confidence shock, investment freeze, trade volume decline, defense crowding out private investment' },
      ship: { full:'Shipping Cost Index vs Pre-Conflict',    pre:'100 index', drivers:'Hormuz/Suez rerouting via Cape of Good Hope, war-risk insurance premiums, port congestion' },
      def:  { full:'Global Defense Spending Increase Yr1',   pre:'$0 extra',  drivers:'NATO emergency pledges, Gulf state mobilization, Israeli and Indian procurement surge' },
      fao:  { full:'FAO Food Price Index Increase',          pre:'0%',        drivers:'Gas-based fertilizer spike, fuel input costs, shipping pass-through, Black Sea/MENA supply shock' },
      fx:   { full:'EM Currency Basket vs USD',              pre:'0%',        drivers:'Flight-to-safety USD inflows, EM energy import bills in USD, capital outflows, central bank rate hikes' },
      dur:  { full:'Estimated Conflict Duration',            pre:'N/A',       drivers:'Historical analogs: Gulf War 7M, Russia-Ukraine 30M+, Iranian proxy complexity, back-channel activity' },
    };

    const m = kpiMeta[kpiId] || { full: kpiLabel || kpiId, pre:'N/A', drivers:'Multiple geopolitical factors' };
    const scenLabel = { baseline:'Baseline (P=50%)', optimistic:'Optimistic (P=22%)', pessimistic:'Pessimistic (P=28%)' }[scenario] || 'Baseline';

    const system = `You are DELAX GEO-RISK explaining a market indicator to an investor who just clicked it on a dashboard.

INDICATOR: ${m.full}
CURRENT VALUE: ${kpiValue || 'N/A'} | PRE-CONFLICT: ${m.pre}
SCENARIO: ${scenLabel} | Brent: $${oilPrice}/bbl | CPI: ${cpi} | GDP: ${gdp}
KEY DRIVERS: ${m.drivers}

Write exactly 4 sections. Start each with **bold label:**. No other markdown.

**What it is:** One plain-English sentence a retiree with no finance background understands.
**Why it's at ${kpiValue || 'this level'}:** 2-3 sentences on the specific conflict forces driving this number under the ${scenario} scenario. Use exact figures.
**Who feels it most:** 2 sentences naming specific countries or population groups and why.
**Investor action:** One direct sentence — buy/avoid/hedge with at least one specific ticker or asset.

Total 120-140 words. Be precise and actionable.`;

    return callClaude(apiKey, system, `Explain the ${m.full} indicator.`, 380, res);
  }

  return res.status(400).json({ error: `Unknown type "${type}". Must be "heatmap" or "kpi".` });
};

/* ── Claude API call helper ── */
async function callClaude(apiKey, systemPrompt, userMsg, maxTokens, res) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMsg }],
      }),
    });

    /* Always try to parse body — Anthropic returns JSON even for errors */
    let body;
    try { body = await response.json(); }
    catch (_) {
      const raw = await response.text().catch(() => '');
      return res.status(502).json({ error: `Anthropic returned non-JSON (status ${response.status})`, raw: raw.slice(0, 300) });
    }

    if (!response.ok) {
      /* Return the exact Anthropic error message to the UI */
      return res.status(response.status).json({
        error:  body?.error?.message || `Anthropic API error — HTTP ${response.status}`,
        type:   body?.error?.type    || 'unknown',
        status: response.status,
      });
    }

    const text = (body.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!text) return res.status(502).json({ error: 'Claude returned empty content block', raw: JSON.stringify(body).slice(0,300) });

    return res.status(200).json({
      narrative:    text,
      inputTokens:  body.usage?.input_tokens  || 0,
      outputTokens: body.usage?.output_tokens || 0,
      model:        body.model || 'claude-haiku-4-5',
      generatedAt:  new Date().toISOString(),
    });

  } catch (err) {
    console.error('[analyze] fetch error:', err.message);
    return res.status(500).json({
      error:  `Network error reaching Anthropic: ${err.message}`,
      hint:   'Verify Vercel can reach api.anthropic.com (no egress block)',
    });
  }
}
