/**
 * KRYNARA GDELT DOC 2.0 search — powers the News & Conflict search bar.
 */
let lastQuery = '';
let lastResult = null;
let lastTime = 0;

function register(app) {
  app.get('/api/gdelt/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    if (query.length < 2) return res.status(400).json({ error: 'Provide at least two characters.' });
    if (query === lastQuery && lastResult && Date.now() - lastTime < 120_000) {
      return res.json(lastResult);
    }
    const params = new URLSearchParams({
      query,
      mode: 'ArtList',
      maxrecords: '50',
      format: 'json',
      sort: 'DateDesc',
    });
    try {
      const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('GDELT returned a non-JSON response for this query.');
      }
      const articles = (data.articles ?? []).map((article) => ({
        title: article.title,
        url: article.url,
        domain: article.domain,
        sourceCountry: article.sourcecountry ?? '',
        language: article.language ?? '',
        date: article.seendate ?? '',
      }));
      lastQuery = query;
      lastResult = { query, articles, total: articles.length, updatedAt: new Date().toISOString() };
      lastTime = Date.now();
      res.json(lastResult);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

module.exports = { register };
