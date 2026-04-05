// File: /api/market.js
// This runs on the server. Your API Key is safe here.

export default async function handler(req, res) {
    // INSERT YOUR FINNHUB API KEY HERE
    const FINNHUB_KEY = 'd768gopr01qm4b7tbbm0d768gopr01qm4b7tbbmg';
    const { symbol } = req.query;

    try {
        // Fetch Live Price Data
        const quoteResponse = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
        const quote = await quoteResponse.json();

        // Fetch Global Geopolitical News
        const newsResponse = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
        const news = await newsResponse.json();

        res.status(200).json({
            price: quote.c,
            change: quote.d,
            percentChange: quote.dp,
            news: news.slice(0, 5) // Send only top 5 headlines
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch data" });
    }
}
