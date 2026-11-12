/**
 * KRYNARA satellites route — proxies live satellite positions (where the ISS at API + Open Notify style).
 * Returns a normalized list the console renders as white dots with orbit trails.
 */
const cache = new Map();
const SAT_IDS = [
  { id: 25544, name: 'ISS (ZARYA)' },
  { id: 48274, name: 'CSS (TIANHE)' },
  { id: 37348, name: 'SUZHOU' },
];

function register(app) {
  app.get('/api/satellites', async (_req, res) => {
    const cached = cache.get('sats');
    if (cached && Date.now() - cached.time < 10_000) return res.json(cached.data);
    const satellites = await Promise.all(SAT_IDS.map(async ({ id, name }) => {
      try {
        const response = await fetch(`https://api.wheretheiss.at/v1/satellites/${id}`, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return { id, name, lat: data.latitude, lon: data.longitude, altitude: data.altitude, velocity: data.velocity, at: data.timestamp };
      } catch {
        return null;
      }
    }));
    const data = { satellites: satellites.filter(Boolean), updatedAt: new Date().toISOString(), source: 'wheretheiss.at' };
    cache.set('sats', { time: Date.now(), data });
    res.json(data);
  });
}

module.exports = { register };
