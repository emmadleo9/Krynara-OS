const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
const RAIN_RADAR_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const CACHE_MS = 2 * 60_000;
const RAIN_RADAR_CACHE_MS = 5 * 60_000;

let cache;
let cacheTime = 0;
let request;
let rainRadarCache;
let rainRadarCacheTime = 0;
let rainRadarRequest;

function register(app) {
  app.get('/api/feeds/rain-radar', async (_req, res) => {
    if (rainRadarCache && Date.now() - rainRadarCacheTime < RAIN_RADAR_CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=120');
      return res.json(rainRadarCache);
    }

    try {
      if (!rainRadarRequest) {
        rainRadarRequest = fetch(RAIN_RADAR_URL, { signal: AbortSignal.timeout(3000) })
          .then(async (response) => {
            if (!response.ok) throw new Error(`RainViewer returned HTTP ${response.status}`);
            const feed = await response.json();
            const host = new URL(feed.host);
            const frames = [...(feed.radar?.past ?? []), ...(feed.radar?.nowcast ?? [])]
              .filter((frame) => typeof frame?.path === 'string'
                && /^\/v2\/radar\/[a-f0-9]+$/i.test(frame.path)
                && Number.isFinite(frame.time))
              .sort((a, b) => a.time - b.time);
            if (host.protocol !== 'https:' || host.hostname !== 'tilecache.rainviewer.com' || frames.length === 0) {
              throw new Error('RainViewer returned invalid radar tile metadata.');
            }
            const toTileUrl = (frame) => `${host.origin}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
            const frame = frames.at(-1);
            return {
              tileUrl: toTileUrl(frame),
              frameTime: frame.time,
              frames: frames.map((item) => ({ tileUrl: toTileUrl(item), time: item.time })),
              source: 'RainViewer',
            };
          });
      }

      rainRadarCache = await rainRadarRequest;
      rainRadarCacheTime = Date.now();
      res.setHeader('Cache-Control', 'public, max-age=120');
      return res.json(rainRadarCache);
    } catch (error) {
      if (rainRadarCache) {
        res.setHeader('Warning', '110 - "RainViewer unavailable; returning cached radar frame"');
        return res.json(rainRadarCache);
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : 'RainViewer radar is unavailable.',
      });
    } finally {
      rainRadarRequest = undefined;
    }
  });

  app.get('/api/feeds/weather-alerts', async (_req, res) => {
    if (cache && Date.now() - cacheTime < CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json(cache);
    }

    try {
      if (!request) {
        request = fetch(ALERTS_URL, {
          headers: { 'User-Agent': 'Krynara-OS World View' },
          signal: AbortSignal.timeout(3000),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`NOAA returned HTTP ${response.status}`);
          const feed = await response.json();
          const features = (feed.features ?? []).flatMap((feature) => {
            const geometry = feature.geometry;
            if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
            const properties = feature.properties ?? {};
            return [{
              type: 'Feature',
              geometry,
              properties: {
                id: properties.id ?? feature.id ?? '',
                event: properties.event ?? 'Weather alert',
                headline: properties.headline ?? '',
                severity: properties.severity ?? 'Unknown',
                urgency: properties.urgency ?? 'Unknown',
                areaDesc: properties.areaDesc ?? '',
                sent: properties.sent ?? '',
                expires: properties.expires ?? '',
                source: 'NOAA National Weather Service',
              },
            }];
          });
          return {
            type: 'FeatureCollection',
            features,
            total: features.length,
            source: 'NOAA National Weather Service',
            updatedAt: new Date().toISOString(),
          };
        });
      }

      cache = await request;
      cacheTime = Date.now();
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json(cache);
    } catch (error) {
      if (cache) {
        res.setHeader('Warning', '110 - "NOAA feed unavailable; returning cached alerts"');
        return res.json(cache);
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : 'NOAA weather alerts are unavailable.',
      });
    } finally {
      request = undefined;
    }
  });
}

module.exports = { register };
