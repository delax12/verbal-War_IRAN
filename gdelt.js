/**
 * /api/gdelt.js — Vercel Serverless Function (CommonJS)
 * ──────────────────────────────────────────────────────
 * GDELT Project proxy — free, no API key required.
 * Fetches conflict/war/attack geo-events from last 48h
 * and aggregates by country for globe ring density overlay.
 *
 * GDELT API: https://api.gdeltproject.org
 * Free · No key · Updates every 15 minutes
 */
'use strict';

// Country code → name mapping for aggregation
const CC_MAP = {
  IR:'Iran', IQ:'Iraq', SA:'Saudi Arabia', YE:'Yemen', SY:'Syria',
  LB:'Lebanon', JO:'Jordan', IL:'Israel', TR:'Turkey', EG:'Egypt',
  LY:'Libya', DZ:'Algeria', MA:'Morocco', TN:'Tunisia', SD:'Sudan',
  NG:'Nigeria', ZA:'South Africa', ET:'Ethiopia', KE:'Kenya', GH:'Ghana',
  SO:'Somalia', CD:'Congo', CM:'Cameroon', ML:'Mali', NE:'Niger',
  IN:'India', PK:'Pakistan', AF:'Afghanistan', MM:'Myanmar', BD:'Bangladesh',
  CN:'China', JP:'Japan', KR:'South Korea', TW:'Taiwan', PH:'Philippines',
  ID:'Indonesia', VN:'Vietnam', TH:'Thailand', MY:'Malaysia',
  RU:'Russia', UA:'Ukraine', BY:'Belarus', PL:'Poland',
  US:'United States of America', MX:'Mexico', BR:'Brazil',
  AR:'Argentina', VE:'Venezuela', CO:'Colombia',
  DE:'Germany', FR:'France', GB:'United Kingdom', IT:'Italy', ES:'Spain',
  KZ:'Kazakhstan', UZ:'Uzbekistan', KW:'Kuwait', QA:'Qatar', AE:'United Arab Emirates',
  OM:'Oman', BH:'Bahrain',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300'); // 15min cache
  if (req.method !== 'GET') return res.status(405).end();

  try {
    // GDELT Doc API — conflict geo-events last 48h
    // Returns articles with location data tagged to countries
    const query = encodeURIComponent('conflict OR war OR attack OR strike OR missile OR explosion');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=250&timespan=48h&format=json`;

    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
    const data = await r.json();

    const articles = data?.articles || [];

    // Count events per country using GDELT source country codes
    const countryCounts = {};
    const countryTones  = {}; // avg tone (negative = more alarming)

    articles.forEach(a => {
      // GDELT returns sourcecountry as 2-letter ISO
      const cc = a.sourcecountry;
      if (!cc) return;
      const name = CC_MAP[cc];
      if (!name) return;
      countryCounts[name] = (countryCounts[name] || 0) + 1;
      // tone: negative = conflict/war coverage, range approx -10 to +10
      const tone = parseFloat(a.tone || '0');
      if (!countryTones[name]) countryTones[name] = [];
      countryTones[name].push(tone);
    });

    // Build result array
    const maxCount = Math.max(...Object.values(countryCounts), 1);
    const results = Object.entries(countryCounts).map(([name, count]) => {
      const tones = countryTones[name] || [0];
      const avgTone = tones.reduce((a, b) => a + b, 0) / tones.length;
      return {
        country:    name,
        count,
        intensity:  parseFloat((count / maxCount).toFixed(3)), // 0–1 normalized
        avgTone:    parseFloat(avgTone.toFixed(2)),             // negative = alarming
        isAlarm:    avgTone < -3 && count > 3,
      };
    }).sort((a, b) => b.count - a.count);

    return res.status(200).json({
      results,
      totalArticles: articles.length,
      fetchedAt:     new Date().toISOString(),
      timespan:      '48h',
    });

  } catch (err) {
    console.error('[gdelt]', err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
};
