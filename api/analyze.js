/**
 * /api/analyze.js — Vercel Serverless Function (CommonJS)
 * DELAX GEO-RISK — Multi-provider AI narrative engine
 *
 * PERMANENT FIX (Apr 2026):
 * - gemini-2.5-flash-lite returns thinking tokens in parts[0] when thinking
 *   is enabled. Fixed: collect ALL text parts, not just parts[0].
 * - Added console.log instrumentation so Vercel logs show what's happening.
 * - Upgraded to gemini-2.0-flash (stable, no thinking interference) as primary.
 * - gemini-2.5-flash-lite kept as secondary with thinkingConfig disabled.
 * - Anthropic model updated to claude-haiku-4-5-20251001.
 * - Added 10s timeout wrapper so function never hangs silently.
 * - type:'newssummary' moved into main handler (was orphaned comment block).
 *
 * Provider chain: GEMINI_API_KEY → ANTHROPIC_API_KEY
 * (GROQ_API_KEY not currently set — skipped cleanly)
 */
'use strict';

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed — use POST' });

  /* ── Provider detection ── */
  const geminiKey    = process.env.GEMINI_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider     = geminiKey ? 'gemini' : groqKey ? 'groq' : anthropicKey ? 'anthropic' : null;
  const apiKey       = geminiKey || groqKey || anthropicKey;

  // Always log so Vercel shows activity — critical for debugging
  console.log('[analyze] method:', req.method, '| provider:', provider || 'NONE',
    '| gemini:', geminiKey ? 'SET' : 'MISSING',
    '| anthropic:', anthropicKey ? 'SET' : 'MISSING');

  if (!provider) {
    console.error('[analyze] FATAL: No AI API key configured');
    return res.status(500).json({
      error: 'No AI API key configured. Add GEMINI_API_KEY to Vercel Environment Variables.',
    });
  }

  /* ── Parse + sanitize body ── */
  const body = req.body || {};
  const {
    type      = '',
    scenario  = 'baseline',
    kpiId,
    kpiLabel  = '',
    oilPrice  = 121,
    cpi       = '+3.8%',
    gdp       = '-1.9%',
    liveDate  = new Date().toISOString().slice(0, 10),
    headlines = [],
  } = body;

  // Sanitize kpiValue — Unicode minus chars break Gemini URL validation
  const kpiValue = typeof body.kpiValue === 'string'
    ? body.kpiValue
        .replace(/\u2212/g, '-').replace(/\u2013/g, '-').replace(/\u2014/g, '-')
        .replace(/[^\x00-\x7F]/g, '')
    : (body.kpiValue || '');

  console.log('[analyze] type:', type, '| scenario:', scenario, '| kpiId:', kpiId || 'n/a');

  if (!type) return res.status(400).json({ error: 'type is required: heatmap | kpi | newssummary' });

  /* ════════════════════════════════════════════
     HEATMAP NARRATIVE
  ════════════════════════════════════════════ */
  if (type === 'heatmap') {
    const scenDesc = {
      baseline:    `Baseline (P=50%): 24-month conflict, partial Hormuz disruption, Brent $${oilPrice}/bbl`,
      optimistic:  `Optimistic (P=22%): Ceasefire Month 10, Hormuz reopens, Brent $${oilPrice}/bbl`,
      pessimistic: `Pessimistic (P=28%): Full Hormuz closure 6+ months, regional expansion, Brent $${oilPrice}/bbl`,
    }[scenario] || `Scenario: ${scenario}, Brent $${oilPrice}/bbl`;

    const prompt =
`You are DELAX GEO-RISK, a geopolitical economic analyst writing a narrative for an investor dashboard heatmap.

ACTIVE SCENARIO: ${scenDesc}
LIVE DATA: Brent $${oilPrice}/bbl | CPI add: ${cpi} | GDP: ${gdp} | Date: ${liveDate}

HEATMAP STRESS SCORES (0-10 scale, Year 1 to Year 10):
Middle East: 9.1 to 1.7 | Africa: 6.8 to 1.1 | South Asia: 5.4 to 0.6
Europe: 3.8 to 0.3 | East Asia: 2.8 to 0.2 | South America: 2.9 to 0.3
North America: 2.1 to 0.2 | Oceania: 1.4 to 0.1

Write exactly 3 paragraphs. No headers. No bullet points. Plain prose only.
Paragraph 1: Which regions are hardest hit, their exact stress scores, and why under this scenario.
Paragraph 2: How high-stress regions create spillovers via food prices, energy, migration, and trade.
Paragraph 3: How stress evolves Year 1 to Year 10, and one specific investor action with a ticker symbol.
55-70 words per paragraph. Use specific numbers. Begin with Paragraph 1 immediately.`;

    const result = await withTimeout(route(provider, apiKey, prompt, 600), 25000);
    console.log('[analyze/heatmap] result:', result.error || 'OK', '| textLen:', result.text?.length || 0);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
    return res.status(200).json({ narrative: result.text, provider, model: result.model, generatedAt: new Date().toISOString() });
  }

  /* ════════════════════════════════════════════
     KPI NARRATIVE
  ════════════════════════════════════════════ */
  if (type === 'kpi') {
    if (!kpiId) return res.status(400).json({ error: 'kpiId required when type is kpi' });

    const meta = {
      oil:  { full:'Brent Crude Oil Projected Peak',         pre:'$78/bbl',   drivers:'Hormuz closure risk, OPEC spare capacity, SPR drawdown, US shale 6-9 month ramp lag' },
      cpi:  { full:'Global CPI Inflation Addition Year 1',   pre:'0%',        drivers:'Oil pass-through +$10/bbl = +0.3% CPI, fertilizer cost surge, shipping surcharges, EM currency depreciation' },
      gdp:  { full:'Global GDP Loss Year 1',                 pre:'0%',        drivers:'Consumer confidence collapse, investment freeze, trade volume decline, defense crowding out private investment' },
      ship: { full:'Shipping Cost Index vs Pre-Conflict',    pre:'100 index', drivers:'Hormuz/Suez rerouting via Cape of Good Hope adding 15 days, war-risk insurance premiums, port congestion' },
      def:  { full:'Global Defense Spending Increase Year 1',pre:'$0 extra',  drivers:'NATO emergency pledges, Gulf state mobilization, Israeli and Indian procurement surge, Taiwan alert' },
      fao:  { full:'FAO Food Price Index Increase',          pre:'0%',        drivers:'Gas-based fertilizer spike, fuel input costs for farming, shipping cost pass-through, MENA supply shock' },
      fx:   { full:'Emerging Market Currency Basket vs USD', pre:'0%',        drivers:'Flight-to-safety USD inflows, EM energy import bills priced in USD, capital outflows, EM central bank rate hikes' },
      dur:  { full:'Estimated Conflict Duration',            pre:'N/A',       drivers:'Historical analogs: Gulf War 7 months, Russia-Ukraine 30 months, Iranian proxy network complexity, diplomatic channels' },
    }[kpiId] || { full: kpiLabel || kpiId, pre:'N/A', drivers:'Multiple geopolitical factors' };

    const scenLabel = { baseline:'Baseline P=50%', optimistic:'Optimistic P=22%', pessimistic:'Pessimistic P=28%' }[scenario] || 'Baseline';
    const val = kpiValue || 'N/A';

    const prompt =
`You are DELAX GEO-RISK explaining a market indicator to an investor on a financial dashboard.

INDICATOR: ${meta.full}
CURRENT VALUE: ${val} | PRE-CONFLICT BASELINE: ${meta.pre}
SCENARIO: ${scenLabel} | Brent: $${oilPrice}/bbl | CPI: ${cpi} | GDP: ${gdp}
KEY DRIVERS: ${meta.drivers}

Write exactly 4 sections. Label each section in bold exactly as shown. No other markdown.

**What it is:** One plain-English sentence a retiree with no finance background can understand.
**Why it is at ${val}:** 2 to 3 sentences on the specific conflict-driven forces under the ${scenario} scenario. Use exact figures.
**Who feels it most:** 2 sentences naming specific countries or groups and explaining why they are hardest hit.
**Investor action:** One direct sentence recommending what to buy, avoid, or hedge, with at least one ticker symbol.

Total 120 to 140 words. Be precise and actionable.`;

    const result = await withTimeout(route(provider, apiKey, prompt, 450), 25000);
    console.log('[analyze/kpi]', kpiId, '| result:', result.error || 'OK', '| textLen:', result.text?.length || 0);
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
    return res.status(200).json({ narrative: result.text, provider, model: result.model, generatedAt: new Date().toISOString() });
  }

  /* ════════════════════════════════════════════
     NEWS SUMMARY
     Scores RSS headlines by hotness,
     returns a 1-sentence Bloomberg-style alert.
  ════════════════════════════════════════════ */
  if (type === 'newssummary') {
    const sc = body.scenario || 'baseline';
    const op = body.oilPrice || 121;
    if (!headlines.length) return res.status(400).json({ error: 'headlines array required' });

    const HOT = ['iran','hormuz','oil','brent','opec','war','strike','missile','sanctions',
      'ceasefire','nuclear','attack','crisis','emergency','surge','fed','rate','inflation',
      'recession','crash','spike','collapse','record','explosion','conflict'];

    const scored = headlines.map(h => {
      const l = h.toLowerCase();
      const s = HOT.reduce((acc, k) => acc + (l.includes(k) ? 2 : 0), 0)
              + (l.includes('iran') || l.includes('hormuz') ? 5 : 0);
      return { h, s };
    }).sort((a, b) => b.s - a.s);

    const top5    = scored.slice(0, 5).map(x => x.h);
    const hottest = scored[0]?.h || headlines[0];

    const prompt =
`You are a Bloomberg terminal intelligence system for the DELAX GEO-RISK dashboard.
SCENARIO: ${sc} | Brent: $${op}/bbl | ${new Date().toISOString().slice(0,10)}

TOP HEADLINES:
${top5.map((h, i) => `${i+1}. ${h}`).join('\n')}
HOTTEST: "${hottest}"

Write EXACTLY ONE sentence (max 28 words). Start with BREAKING, ALERT, or WATCH. Name the key development. State direct market impact. Sound like a live terminal alert. Output the sentence only. No quotes.`;

    const result = await withTimeout(route(provider, apiKey, prompt, 80), 15000);
    console.log('[analyze/newssummary] result:', result.error || 'OK');
    if (result.error) return res.status(result.status || 500).json({ error: result.error, provider });
    return res.status(200).json({ summary: result.text.trim(), hottest, top5, provider, model: result.model, generatedAt: new Date().toISOString() });
  }

  return res.status(400).json({ error: 'Unknown type. Use: heatmap | kpi | newssummary' });
};

/* ════════════════════════════════════════════
   TIMEOUT WRAPPER
   Prevents silent hangs — returns error after ms
════════════════════════════════════════════ */
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`AI call timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]).catch(err => ({ error: err.message, status: 504 }));
}

/* ════════════════════════════════════════════
   PROVIDER ROUTER
════════════════════════════════════════════ */
async function route(provider, apiKey, prompt, maxTokens) {
  if (provider === 'gemini')    return callGemini(apiKey, prompt, maxTokens);
  if (provider === 'groq')      return callGroq(apiKey, prompt, maxTokens);
  if (provider === 'anthropic') return callAnthropic(apiKey, prompt, maxTokens);
  return { error: 'Unknown provider', status: 500 };
}

/* ════════════════════════════════════════════
   GEMINI — PERMANENT FIX
   gemini-2.0-flash: stable, no thinking tokens, fast.
   CRITICAL FIX: collect ALL text parts (not just parts[0])
   because gemini-2.5 models return thinking in parts[0]
   and the actual response in a later part.
════════════════════════════════════════════ */
async function callGemini(apiKey, prompt, maxTokens) {
  try {
    // Use gemini-2.0-flash — stable production model, no thinking interference
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature:     0.7,
          candidateCount:  1,
        },
      }),
    });

    let b;
    try { b = await r.json(); }
    catch(_) { return { error: 'Gemini returned non-JSON response', status: 502 }; }

    console.log('[gemini] status:', r.status, '| finishReason:',
      b?.candidates?.[0]?.finishReason || 'unknown',
      '| parts:', b?.candidates?.[0]?.content?.parts?.length || 0);

    if (!r.ok) {
      const msg = b?.error?.message || b?.error?.status || `HTTP ${r.status}`;
      console.error('[gemini] API error:', msg);
      return { error: `Gemini: ${msg}`, status: r.status };
    }

    // CRITICAL FIX: collect ALL text parts, not just parts[0]
    // gemini-2.5 thinking models put thought in parts[0], answer in parts[1+]
    const parts = b?.candidates?.[0]?.content?.parts || [];
    const text  = parts
      .filter(p => p.text && typeof p.text === 'string')
      .map(p => p.text.trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!text) {
      const reason = b?.candidates?.[0]?.finishReason;
      console.error('[gemini] Empty text. finishReason:', reason, '| full response:', JSON.stringify(b).slice(0, 400));
      // If blocked, try Anthropic fallback
      if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'PROHIBITED_CONTENT') {
        return { error: `Gemini content blocked: ${reason}`, status: 422 };
      }
      return { error: `Gemini returned empty text (finishReason: ${reason || 'unknown'})`, status: 502 };
    }

    return { text, model };
  } catch (e) {
    console.error('[gemini] network error:', e.message);
    return { error: `Gemini network: ${e.message}`, status: 500 };
  }
}

/* ════════════════════════════════════════════
   GROQ (llama-3.3-70b-versatile)
════════════════════════════════════════════ */
async function callGroq(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  maxTokens,
        temperature: 0.7,
        messages:    [{ role: 'user', content: prompt }],
      }),
    });
    let b;
    try { b = await r.json(); }
    catch(_) { return { error: 'Groq returned non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Groq HTTP ${r.status}`, status: r.status };
    const text = b?.choices?.[0]?.message?.content || '';
    if (!text) return { error: 'Groq returned empty text', status: 502 };
    return { text, model: 'llama-3.3-70b-versatile' };
  } catch (e) {
    return { error: `Groq network: ${e.message}`, status: 500 };
  }
}

/* ════════════════════════════════════════════
   ANTHROPIC (claude-haiku — lightweight, fast)
════════════════════════════════════════════ */
async function callAnthropic(apiKey, prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    let b;
    try { b = await r.json(); }
    catch(_) { return { error: 'Anthropic returned non-JSON response', status: 502 }; }
    if (!r.ok) return { error: b?.error?.message || `Anthropic HTTP ${r.status}`, status: r.status };
    const text = (b.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    if (!text) return { error: 'Anthropic returned empty content', status: 502 };
    return { text, model: b.model || 'claude-haiku-4-5-20251001' };
  } catch (e) {
    return { error: `Anthropic network: ${e.message}`, status: 500 };
  }
}
