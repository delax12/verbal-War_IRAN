/**
 * /api/test.js — Debug endpoint (safe to leave deployed)
 * ────────────────────────────────────────────────────────
 * Visit: https://your-domain.com/api/test
 * Returns JSON showing exact error so you can diagnose fast.
 * Does NOT expose the key value — only checks presence and does
 * a minimal real API call to verify the key actually works.
 */

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.ANTHROPIC_API_KEY;

  /* Step 1 — key presence */
  if (!apiKey) {
    return res.status(500).json({
      status:  'FAIL',
      step:    'env_var',
      message: 'ANTHROPIC_API_KEY is NOT set in Vercel environment variables.',
      fix:     'Vercel → Project → Settings → Environment Variables → add ANTHROPIC_API_KEY → Redeploy',
    });
  }

  /* Step 2 — key format sanity */
  if (!apiKey.startsWith('sk-ant-')) {
    return res.status(500).json({
      status:  'FAIL',
      step:    'key_format',
      message: 'ANTHROPIC_API_KEY does not start with sk-ant- — it may be pasted incorrectly.',
      keyPreview: apiKey.slice(0, 10) + '…',
    });
  }

  /* Step 3 — live API ping (minimal token cost) */
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
        max_tokens: 10,
        messages:   [{ role: 'user', content: 'Say: OK' }],
      }),
    });

    let body;
    try { body = await response.json(); } catch(_) { body = {}; }

    if (!response.ok) {
      return res.status(200).json({
        status:     'FAIL',
        step:       'api_call',
        httpStatus: response.status,
        message:    body?.error?.message || `Anthropic returned HTTP ${response.status}`,
        type:       body?.error?.type    || 'unknown',
        hint: response.status === 401
          ? 'Invalid API key — check it was copied correctly from console.anthropic.com'
          : response.status === 429
          ? 'Rate limit or billing issue — check usage at console.anthropic.com'
          : 'Check Anthropic status at status.anthropic.com',
      });
    }

    return res.status(200).json({
      status:       'OK',
      message:      'ANTHROPIC_API_KEY is valid and Claude is reachable.',
      model:        body.model,
      keyPreview:   apiKey.slice(0, 14) + '…',
      inputTokens:  body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
      testedAt:     new Date().toISOString(),
    });

  } catch (err) {
    return res.status(200).json({
      status:  'FAIL',
      step:    'network',
      message: `Cannot reach api.anthropic.com: ${err.message}`,
      hint:    'Vercel may be blocking outbound HTTPS — check Vercel project network settings',
    });
  }
};
