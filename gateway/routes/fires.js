/**
 * NASA EONET wildfire events — LIVE fire markers for World View.
 */
let cache = null;
let cacheTime = 0;

module.exports = {
  register(app) {
    app.get('/api/feeds/fires', async (_req, res) => {
      if (cache && Date.now() - cacheTime < 10 * 60_000) return res.json(cache);
      try {
        const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=200', { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`EONET returned HTTP ${response.status}`);
        const data = await response.json();
        const events = (data.events ?? []).map((event) => {
          const geometry = event.geometry?.[event.geometry.length - 1];
          const coordinates = geometry?.coordinates ?? [];
          return {
            id: event.id,
            title: event.title,
            lon: coordinates[0],
            lat: coordinates[1],
            date: geometry?.date ?? '',
          };
        }).filter((event) => Number.isFinite(event.lon) && Number.isFinite(event.lat));
        cache = { events, updatedAt: new Date().toISOString(), source: 'NASA EONET' };
        cacheTime = Date.now();
        res.json(cache);
      } catch (error) {
        if (cache) return res.json(cache); // stale fallback
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  },
};
