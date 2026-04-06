/**
 * /api/whatif.js — Vercel Serverless Function (CommonJS)
 * ────────────────────────────────────────────────────────
 * Secure proxy for Anthropic Claude API.
 * Powers the "What If" scenario reasoning box in the dashboard.
 * Keeps ANTHROPIC_API_KEY server-side — never exposed to the browser.
 *
 * SETUP (one-time in Vercel Dashboard):
 *   1. vercel.com → Your Project → Settings → Environment Variables
 *   2. Add:  Name = ANTHROPIC_API_KEY  |  Value = <your key from console.anthropic.com>
 *   3. Check: ✅ Production  ✅ Preview  ✅ Development
 *   4. Save → Deployments → Redeploy
 *
 * ENDPOINT called from index.html:
 *   POST /api/whatif
 *   Body: { query, scenario, oilPrice, cpi, gdp, liveDate, newsHeadlines[] }
 *   Returns: { analysis, scenarioTrigger, confidence, sources }
 *
 * MODEL: claude-haiku-4-5-20251001 (fast, cost-efficient for dashboard use)
 * COST:  ~$0.003 per query at typical length — very affordable
 * CACHE: No caching — every query gets fresh reasoning
 */

module.exports = async function handler(req, res) {


  /* ── CORS headers ── */
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Only allow POST ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Read key from Vercel environment ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured.',
      fix: 'Vercel Dashboard → Settings → Environment Variables → Add ANTHROPIC_API_KEY',
      docs: 'https://console.anthropic.com/'
    });
  }

  // ── Parse request body ──
  const {
    query          = '',
    scenario       = 'baseline',
    oilPrice       = 121,
    cpi            = '+3.8%',
    gdp            = '-1.9%',
    shipping       = '+310%',
    liveDate       = 'unknown',
    newsHeadlines  = [],
  } = req.body || {};

  if (!query.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  // ── Build contextual system prompt ──
  const systemPrompt = `You are DELAX GEO-RISK, an elite geopolitical financial intelligence analyst.
You specialize in modeling the economic impact of the 2026 Iran War on global markets.

CURRENT LIVE DASHBOARD STATE:
- Active Scenario: ${scenario} (Baseline=50% prob, Optimistic=22%, Pessimistic=28%)
- Live Brent Crude: $${oilPrice}/bbl (EIA data as of ${liveDate})
- Global CPI Addition (Yr1): ${cpi}
- Global GDP Impact (Yr1): ${gdp}
- Shipping Cost Index: ${shipping}
- Pre-conflict oil anchor: $78/bbl
- Strait of Hormuz: 20% of global oil supply at risk
- Conflict duration estimate: 18–36 months (Baseline)

RECENT NEWS CONTEXT:
${newsHeadlines.length > 0
  ? newsHeadlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')
  : 'No live headlines available — reasoning from model priors.'}

RESPONSE FORMAT:
Provide a structured analysis with these exact sections:
1. **SCENARIO ASSESSMENT** (2-3 sentences): What the query implies and which scenario it maps to
2. **MARKET IMPACT** (3-4 bullet points): Specific price/index effects with ranges (e.g., "Oil: $165–$195/bbl")
3. **INVESTOR ACTION** (2-3 bullet points): Concrete buy/avoid/hedge recommendations with tickers
4. **KEY RISK** (1 sentence): The single biggest uncertainty in this scenario
5. **CONFIDENCE**: Low / Medium / High with one-line rationale

Keep the tone sharp, data-driven, and actionable. Use specific numbers, not vague ranges.
Maximum 280 words total. No markdown headers beyond bold — use the numbered structure above.`;

  const userMessage = `Analyze this what-if scenario for the DELAX GEO-RISK dashboard:

"${query}"

Ground your reasoning in the current live dashboard data and recent news headlines provided.`;

  // ── Call Anthropic API ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system:     systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({
        error:  `Anthropic API returned ${response.status}`,
        detail: errBody.slice(0, 300),
      });
    }

    const data = await response.json();

    // Extract text from content blocks
    const analysis = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    if (!analysis) {
      return res.status(502).json({ error: 'No text content in API response', raw: data });
    }

    // ── Detect which scenario the query maps to ──
    const lowerQ = query.toLowerCase();
    let scenarioTrigger = 'baseline';
    if (['hormuz close', 'hormuz block', '200', 'recession', '5 year', 'five year', 'nuclear', 'saudi strike'].some(k => lowerQ.includes(k))) {
      scenarioTrigger = 'pessimistic';
    } else if (['ceasefire', 'peace', 'deal', 'resolve', 'end war', 'diplomacy'].some(k => lowerQ.includes(k))) {
      scenarioTrigger = 'optimistic';
    }

    return res.status(200).json({
      analysis,
      scenarioTrigger,
      inputTokens:  data.usage?.input_tokens  || 0,
      outputTokens: data.usage?.output_tokens || 0,
      model:        data.model || 'claude-haiku-4-5-20251001',
      analyzedAt:   new Date().toISOString(),
    });

  } catch (err) {
    console.error('[whatif] fetch error:', err.message);
    return res.status(500).json({
      error:  'Upstream fetch to Anthropic API failed',
      detail: err.message,
    });
  }
};
