/**
 * /api/test.js — Live API key diagnostic
 * Visit: https://verbal-war-iran.vercel.app/api/test
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const geminiKey    = process.env.GEMINI_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider     = geminiKey ? 'gemini' : groqKey ? 'groq' : anthropicKey ? 'anthropic' : 'NONE';

  if (provider === 'NONE') {
    return res.status(500).json({
      status:  'FAIL — no key found',
      keys:    { GEMINI_API_KEY: 'NOT SET', GROQ_API_KEY: 'NOT SET', ANTHROPIC_API_KEY: 'NOT SET' },
      fix:     'Add one of these keys to Vercel → Settings → Environment Variables, then Redeploy',
      guides:  { gemini: 'aistudio.google.com (free)', groq: 'console.groq.com (free)', anthropic: 'console.anthropic.com (paid $5 min)' },
    });
  }

  const keyPreview = (k) => k ? k.slice(0, 8) + '...' : 'NOT SET';
  let test = {};

  try {
    if (provider === 'gemini') {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:'Reply with exactly the word: OK'}]}], generationConfig:{maxOutputTokens:5} }) }
      );
      const b = await r.json().catch(() => ({}));
      test = r.ok
        ? { status:'OK ✅', model:'gemini-2.0-flash', response: b?.candidates?.[0]?.content?.parts?.[0]?.text }
        : { status:'FAIL ❌', httpStatus: r.status, error: b?.error?.message || 'unknown', hint: r.status===400?'Bad request — key may be wrong or project not enabled':'Check console.cloud.google.com' };
    }

    if (provider === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions',
        { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},
          body: JSON.stringify({ model:'llama-3.3-70b-versatile', max_tokens:5, messages:[{role:'user',content:'Reply: OK'}] }) }
      );
      const b = await r.json().catch(() => ({}));
      test = r.ok
        ? { status:'OK ✅', model:'llama-3.3-70b-versatile', response: b?.choices?.[0]?.message?.content }
        : { status:'FAIL ❌', httpStatus: r.status, error: b?.error?.message };
    }

    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages',
        { method:'POST', headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:5, messages:[{role:'user',content:'Reply: OK'}] }) }
      );
      const b = await r.json().catch(() => ({}));
      test = r.ok
        ? { status:'OK ✅', model:'claude-haiku-4-5-20251001', response: b?.content?.[0]?.text }
        : { status:'FAIL ❌', httpStatus: r.status, error: b?.error?.message, type: b?.error?.type };
    }
  } catch (err) {
    test = { status:'FAIL ❌ — network error', error: err.message, hint:'Vercel may be blocking outbound HTTPS' };
  }

  return res.status(200).json({
    activeProvider: provider,
    keyStatus: {
      GEMINI_API_KEY:    keyPreview(geminiKey),
      GROQ_API_KEY:      keyPreview(groqKey),
      ANTHROPIC_API_KEY: keyPreview(anthropicKey),
    },
    liveTest: test,
    testedAt: new Date().toISOString(),
  });
};
