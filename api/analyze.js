/**
 * /api/analyze.js — Vercel Serverless Function (CommonJS)
 * ─────────────────────────────────────────────────────────
 * Claude AI-powered contextual analysis endpoint.
 * Serves two types of intelligent narrative:
 *
 *   type: 'heatmap'  → Full scenario narrative for the Continental Stress Heatmap
 *   type: 'kpi'      → Click-to-explain narrative for a specific KPI card
 *
 * Requires: ANTHROPIC_API_KEY in Vercel Environment Variables
 * Model: claude-sonnet-4-20250514
 */

module.exports = async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured.',
      fix: 'Vercel Dashboard → Settings → Environment Variables → Add ANTHROPIC_API_KEY'
    });
  }

  const { type, scenario, kpiId, kpiValue, kpiLabel, oilPrice, cpi, gdp, liveDate } = req.body || {};

  if (!type) return res.status(400).json({ error: 'type is required (heatmap or kpi)' });

  /* ════════════════════════════════════════════════════
     HEATMAP NARRATIVE
     Describes what the full regional stress picture means
     for this scenario, who's winning/losing, and outlook.
  ════════════════════════════════════════════════════ */
  if (type === 'heatmap') {

    const scenarioDescriptions = {
      baseline:    'Baseline (P=50%): 24-month conflict, partial Hormuz disruption, Brent at $' + oilPrice,
      optimistic:  'Optimistic (P=22%): Ceasefire by Month 10, oil at $' + oilPrice + ', rapid reconstruction begins',
      pessimistic: 'Pessimistic (P=28%): Full Hormuz closure 6+ months, Brent at $' + oilPrice + ', regional expansion',
    };

    const heatmapContext = `
Regional stress index values (0-10 scale, higher = more economic damage):
- Middle East (non-Iran): 9.1 → drops to 1.7 by Year 10
- Africa (Sub-Saharan + North): 6.8 → drops to 1.1 by Year 10
- South Asia: 5.4 → drops to 0.6 by Year 10
- Europe: 3.8 → drops to 0.3 by Year 10
- East Asia: 2.8 → drops to 0.2 by Year 10
- South America: 2.9 → drops to 0.3 by Year 10
- North America: 2.1 → drops to 0.2 by Year 10
- Oceania: 1.4 → drops to 0.1 by Year 10`;

    const systemPrompt = `You are DELAX GEO-RISK, an elite geopolitical economic analyst writing a dashboard narrative.
Write a clear, data-driven 3-paragraph narrative explaining the Continental Economic Stress Heatmap.

CURRENT SCENARIO: ${scenarioDescriptions[scenario] || scenarioDescriptions.baseline}
LIVE OIL PRICE: $${oilPrice}/bbl (as of ${liveDate || 'today'})
CURRENT CPI IMPACT: ${cpi}  |  GDP IMPACT: ${gdp}

HEATMAP DATA:
${heatmapContext}

PARAGRAPH STRUCTURE:
1. "REGIONAL EPICENTER" — Which regions are hardest hit and exactly why under this scenario. Use specific stress numbers.
2. "CASCADING EFFECTS" — How high-stress regions create spillovers into lower-stress ones (supply chains, migration, food, energy).
3. "10-YEAR TRAJECTORY & INVESTOR SIGNAL" — How stress evolves from Year 1 to Year 10, and the single most important investor action for this scenario.

Style: Sharp, professional, specific numbers. Each paragraph 50-70 words. No markdown headers — just the paragraph text.
Total: ~180 words. Start directly with the first paragraph, no intro line.`;

    return callClaude(apiKey, systemPrompt, 'Analyze the heatmap for this scenario.', 450, res);
  }

  /* ════════════════════════════════════════════════════
     KPI NARRATIVE
     Click-to-explain for any of the 8 KPI cards.
     Explains the indicator in plain English with
     investor-grade context and specific action.
  ════════════════════════════════════════════════════ */
  if (type === 'kpi') {

    if (!kpiId) return res.status(400).json({ error: 'kpiId is required for type kpi' });

    const kpiContext = {
      oil:  { full: 'Brent Crude Oil (Projected Peak Price)', unit: '$/bbl', preConflict: '$78',  driver: 'Strait of Hormuz risk, OPEC+ spare capacity limits, SPR drawdown timing, shale ramp-up lag' },
      cpi:  { full: 'Global CPI Inflation Addition (Year 1)', unit: '%',     preConflict: '0%',   driver: 'Oil price transmission (+$10/bbl = +0.3% CPI), fertilizer costs, shipping surcharges, currency depreciation' },
      gdp:  { full: 'Global GDP Impact (Year 1)',             unit: '%',     preConflict: '0%',   driver: 'Consumer confidence shock, investment freeze, trade volume decline, defense spending crowding out' },
      ship: { full: 'Shipping Cost Index',                    unit: '% vs pre-conflict', preConflict: '100 (index)', driver: 'Hormuz/Suez rerouting via Cape of Good Hope (+15 days), war risk insurance premiums, port congestion' },
      def:  { full: 'Global Defense Spending Increase (Yr1)', unit: '$B',    preConflict: '$0 extra', driver: 'NATO emergency pledges, Gulf state mobilization, Israel, India procurement surge' },
      fao:  { full: 'FAO Food Price Index Increase',          unit: '%',     preConflict: '0%',   driver: 'Fertilizer (gas-based) cost surge, fuel input for agriculture, shipping costs, Black Sea/MENA supply disruption' },
      fx:   { full: 'EM Currency Basket vs USD',              unit: '%',     preConflict: '0%',   driver: 'Flight-to-safety USD inflows, EM energy import bills in USD, capital outflows, central bank rate hikes' },
      dur:  { full: 'Estimated Conflict Duration',            unit: 'months', preConflict: 'N/A', driver: 'Historical analogs: Gulf War 7M, Russia-Ukraine 30M+, Iranian proxy warfare patterns, diplomatic channel activity' },
    };

    const ctx = kpiContext[kpiId] || { full: kpiLabel, unit: '', preConflict: 'N/A', driver: 'Multiple factors' };

    const systemPrompt = `You are DELAX GEO-RISK, explaining a market indicator to an investor who just clicked on it.

INDICATOR: ${ctx.full}
CURRENT VALUE: ${kpiValue} (pre-conflict baseline: ${ctx.preConflict})
SCENARIO: ${scenario.charAt(0).toUpperCase() + scenario.slice(1)} (${scenario === 'baseline' ? 'P=50%, 24M conflict' : scenario === 'optimistic' ? 'P=22%, ceasefire by M10' : 'P=28%, Hormuz closed 6M+'})
LIVE OIL: $${oilPrice}/bbl | CPI ADD: ${cpi} | GDP: ${gdp}
KEY DRIVERS: ${ctx.driver}

Write exactly 4 short sections (no headers, use bold for the section label):

**What it is:** One sentence plain-English definition anyone can understand.
**Why it's at ${kpiValue}:** 2-3 sentences explaining the specific drivers under this scenario.
**Who feels it most:** 2 sentences on the regions, sectors, or people most affected.
**Investor action:** 1 specific actionable sentence (buy/avoid/hedge with example tickers or assets).

Total: ~130 words. Be direct, specific, and use exact numbers where possible.`;

    return callClaude(apiKey, systemPrompt, `Explain the ${ctx.full} indicator.`, 350, res);
  }

  return res.status(400).json({ error: `Unknown type: ${type}. Use 'heatmap' or 'kpi'.` });
};

/* ── Shared Claude call helper ── */
async function callClaude(apiKey, systemPrompt, userMessage, maxTokens, res) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Claude API error ${response.status}`, detail: err.slice(0, 300) });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!text) return res.status(502).json({ error: 'No text in Claude response' });

    return res.status(200).json({
      narrative:    text,
      inputTokens:  data.usage?.input_tokens  || 0,
      outputTokens: data.usage?.output_tokens || 0,
      model:        data.model || 'claude-sonnet-4-20250514',
      generatedAt:  new Date().toISOString(),
    });

  } catch (err) {
    console.error('[analyze]', err.message);
    return res.status(500).json({ error: 'Upstream Claude fetch failed', detail: err.message });
  }
}
