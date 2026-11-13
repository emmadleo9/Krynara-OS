const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const express = require('express');
const si = require('systeminformation');
const AdmZip = require('adm-zip');

const repoRoot = path.resolve(__dirname, '..');
for (const envFile of [
  path.join(repoRoot, 'console', '.env.local'),
  path.join(repoRoot, '.env.local'),
  path.join(repoRoot, '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env'),
]) {
  if (!fs.existsSync(envFile)) continue;
  const result = dotenv.config({ path: envFile });
  if (result.error) throw result.error;
}

const { createServer } = require('node:http');
const memoryDb = require('./routes/memory');
const whatsapp = require('./routes/krynara-whatsapp');
const satellitesRoute = require('./routes/satellites');
const gdeltSearch = require('./routes/gdelt-search');
const firesRoute = require('./routes/fires');
const worldFeedsRoute = require('./routes/world-feeds');
const directionsRoute = require('./routes/directions');
const transitRoute = require('./routes/transit');
const windRoute = require('./routes/wind');
const tasksRoute = require('./routes/system-tasks');
const keysRoute = require('./routes/keys');
const novaRoute = require('./routes/nova');
const localAiRoute = require('./routes/local-ai');
const onlineAiRoute = require('./routes/online-ai');
const telegramRoute = require('./routes/telegram');
const storageStatsRoute = require('./routes/storage-stats');
const native = require('./native/client');

const app = express();
const server = createServer(app);
// Bound every stage of a connection. The previous 12-hour requestTimeout let a
// single stuck client hold a socket (and its session) indefinitely.
server.requestTimeout = 30_000;      // total time to receive a full request
server.headersTimeout = 15_000;      // time to receive headers
server.keepAliveTimeout = 5_000;     // idle keep-alive window
server.connectionsCheckingInterval = 10_000;
// server.timeout stays at its default (0 = no socket inactivity limit) so long
// SSE/telemetry streams are not cut; requestTimeout above bounds the request.
const port = Number(process.env.GATEWAY_PORT || process.env.KRYNARA_PORT || 2785);
const consolePort = Number(process.env.CONSOLE_PORT || 5173);

// Start the native compute sidecar (Rust) if it was built. Every call site
// falls back to the JavaScript implementation when the sidecar is unavailable.
native.start();
void native.refresh();
const allowedOrigins = new Set([
  `http://localhost:${consolePort}`,
  `http://127.0.0.1:${consolePort}`,
]);
// Env-configured origins (CORS_ORIGINS), so deployments like Tailscale access can be extended
// without code changes. Bare-host entries are expanded to every origin shape for the console port.
for (const raw of String(process.env.CORS_ORIGINS || '').split(',')) {
  const entry = raw.trim();
  if (!entry || entry === '*') continue;
  allowedOrigins.add(entry);
  try {
    const url = new URL(entry);
    if (!url.pathname || url.pathname === '/') {
      allowedOrigins.add(`${url.protocol}//${url.host}`);
      allowedOrigins.add(`${url.protocol}//${url.hostname}:${consolePort}`);
    }
  } catch { }
}
// Tailscale access (phone/browser over tailnet): accept both http and https for the machine's
// MagicDNS name, whatever the deployment sets it to.
for (const host of [process.env.KRYNARA_TAILSCALE_HOST, os.hostname().toLowerCase()]) {
  if (!host) continue;
  for (const candidate of [`${host}.ts.net`, host]) {
    if (candidate.includes('.')) {
      allowedOrigins.add(`https://${candidate}`);
      allowedOrigins.add(`http://${candidate}`);
      allowedOrigins.add(`https://${candidate}:${consolePort}`);
      allowedOrigins.add(`http://${candidate}:${consolePort}`);
    }
  }
}
const logs = [];

function log(message) {
  const entry = `[${new Date().toISOString()}] ${message}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  console.log(entry);
}

app.disable('x-powered-by');
// Large body allowance for /api/nova/save (base64 image payloads); 16kb elsewhere would
// reject every generated image before the route's own 20GB quota check can run.
app.use(['/api/nova/save'], express.json({ limit: '64mb' }));
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const healthResponse = (_req, res) => res.json({ status: 'online', service: 'krynara-local-gateway', timestamp: new Date().toISOString() });
app.get(['/api/health', '/gateway/health'], healthResponse);

memoryDb.registerMemoryRoutes(app);
satellitesRoute.register(app);
gdeltSearch.register(app);
firesRoute.register(app);
worldFeedsRoute.register(app);
directionsRoute.register(app);
transitRoute.register(app);
windRoute.register(app);
tasksRoute.register(app);
keysRoute.register(app);
localAiRoute.register(app, novaRoute.IMAGE_MODELS);
onlineAiRoute.register(app);
novaRoute.register(app);
whatsapp.registerKrynaraWhatsApp(app);
telegramRoute.register(app);
storageStatsRoute.register(app);

app.get('/api/weather', async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  }
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,wind_speed_10m,relative_humidity_2m,surface_pressure',
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '3',
    timezone: 'auto',
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(await response.json());
  } catch (error) {
    log(`weather forecast failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(502).json({ error: 'Weather forecast is unavailable.' });
  }
});

app.get('/api/geocode', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query.length < 2) return res.status(400).json({ error: 'Enter at least two characters to search for a place.' });
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' });
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Geocoding returned HTTP ${response.status}`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(await response.json());
  } catch (error) {
    log(`city search failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(502).json({ error: 'City search is unavailable.' });
  }
});

const publicFeeds = {
  iss: 'https://api.wheretheiss.at/v1/satellites/25544',
  usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
};

const flightRegions = [
  [40, -74], [50, 15], [25, 55], [33, 73], [35, 136], [-23, -46], [-33, 151],
];
let flightCache;
let flightCacheTime = 0;
let flightRequest;
let gdeltCache;
let gdeltCacheTime = 0;
let gdeltRequest;

async function loadAircraft() {
  const primary = await fetch('https://api.adsb.lol/v2/all', { signal: AbortSignal.timeout(8000) });
  if (primary.ok) {
    const data = await primary.json();
    if (Array.isArray(data.ac) && data.ac.length) return { ac: data.ac.slice(0, 400), total: data.ac.length, source: 'adsb.lol' };
  }
  log(`ADS-B global endpoint unavailable (HTTP ${primary.status}); using regional public feeds`);

  const collected = [];
  const seenHex = new Set();

  // Sweep regions with bounded concurrency. Previously this was strictly
  // sequential with an 1100ms sleep between regions — 7 regions cost 6.6s of
  // pure waiting. Three at a time keeps us under api.adsb.lol's rate limit
  // without the dead time.
  const REGION_CONCURRENCY = 3;
  let cursor = 0;
  let done = false;

  const lane = async () => {
    while (!done) {
      const index = cursor++;
      if (index >= flightRegions.length || done) return;
      const [latitude, longitude] = flightRegions[index];
      const url = `https://api.adsb.lol/v2/lat/${latitude}/lon/${longitude}/dist/250`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          log(`ADS-B regional source returned HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        for (const item of data.ac || []) {
          // Mirror the JS Map guard: only truthy hex values are tracked. The Set
          // is used solely to decide when to stop sweeping regions.
          if (item && typeof item.hex === 'string' && item.hex) seenHex.add(item.hex);
          collected.push(item);
          if (seenHex.size >= 400) { done = true; return; }
        }
      } catch (error) {
        log(`ADS-B regional source failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(REGION_CONCURRENCY, flightRegions.length) }, lane));

  if (!collected.length) throw new Error('Primary and regional ADS-B sources returned no aircraft.');

  // Fast path: Rust sidecar performs the Map-equivalent merge. Falls back to the
  // JavaScript merge below on any failure.
  if (native.isEnabled()) {
    try {
      const payload = Buffer.from(JSON.stringify(collected));
      const merged = await native.call('/adsb/dedupe', payload, 5000);
      if (Array.isArray(merged)) {
        log(`ADS-B regional fallback supplied ${merged.length} aircraft`);
        return { ac: merged.slice(0, 400), total: merged.length, source: 'adsb.lol regional sweep' };
      }
    } catch (error) {
      log(`adsb native merge unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // JS fallback: exact Map semantics (case-sensitive, last value wins, first
  // position kept, hex-less entries dropped).
  const aircraft = new Map();
  for (const item of collected) {
    if (item && typeof item.hex === 'string' && item.hex) aircraft.set(item.hex, item);
  }
  if (!aircraft.size) throw new Error('Primary and regional ADS-B sources returned no aircraft.');
  log(`ADS-B regional fallback supplied ${aircraft.size} aircraft`);
  return { ac: [...aircraft.values()].slice(0, 400), total: aircraft.size, source: 'adsb.lol regional sweep' };
}

async function loadGdeltEvents() {
  const updatesResponse = await fetch('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', { signal: AbortSignal.timeout(12000) });
  if (!updatesResponse.ok) throw new Error(`GDELT index returned HTTP ${updatesResponse.status}`);
  const updates = await updatesResponse.text();
  const archiveUrl = updates.split(/\r?\n/).map((line) => line.trim().split(/\s+/).pop()).find((url) => url && url.endsWith('.export.CSV.zip'));
  if (!archiveUrl) throw new Error('GDELT index did not list an events archive.');

  const httpsUrl = archiveUrl.replace(/^http:/, 'https:');

  // GDELT publishes one archive per 15-minute window and keeps it at a stable
  // URL for that window. Cache the downloaded bytes on disk keyed by URL so a
  // refresh inside the same window skips the multi-MB download entirely.
  let archiveBuffer;
  const cacheFile = path.join(os.tmpdir(), 'krynara-gdelt-cache', `${crypto.createHash('sha1').update(httpsUrl).digest('hex')}.zip`);
  try {
    const cached = await fs.promises.readFile(cacheFile);
    if (cached.length > 0) {
      archiveBuffer = cached;
      log(`GDELT archive served from disk cache (${(cached.length / 1024 / 1024).toFixed(1)} MB)`);
    }
  } catch {
    /* not cached yet */
  }

  if (!archiveBuffer) {
    const archiveResponse = await fetch(httpsUrl, { signal: AbortSignal.timeout(20000) });
    if (!archiveResponse.ok) throw new Error(`GDELT archive returned HTTP ${archiveResponse.status}`);
    archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
    // Persist for the next refresh in the same window. Best effort: a write
    // failure must not fail the request.
    fs.promises.mkdir(path.dirname(cacheFile), { recursive: true })
      .then(() => fs.promises.writeFile(cacheFile, archiveBuffer))
      .catch(() => { /* disk full / permissions — ignore */ });
  }

  // Fast path: Rust sidecar inflates + parses the CSV. Falls back to the
  // JavaScript implementation below on any failure.
  if (native.isEnabled()) {
    try {
      const parsed = await native.call('/gdelt/parse', archiveBuffer, 10_000);
      if (parsed && Array.isArray(parsed.features)) {
        return { ...parsed, updatedAt: new Date().toISOString() };
      }
    } catch (error) {
      log(`gdelt native parse unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const archive = new AdmZip(archiveBuffer);
  const entry = archive.getEntries()[0];
  if (!entry) throw new Error('GDELT archive was empty.');

  const features = [];
  for (const row of entry.getData().toString('utf8').split(/\r?\n/)) {
    const columns = row.split('\t');
    const quad = Number(columns[29]);
    const latitude = Number(columns[56]);
    const longitude = Number(columns[57]);
    if ((quad !== 3 && quad !== 4) || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !latitude || !longitude) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: {
        name: columns[52] || columns[53] || 'GDELT event',
        articles: Number(columns[33]) || 0,
        tone: Number(columns[34]) || 0,
        url: columns[60] || '',
      },
    });
    if (features.length >= 150) break;
  }
  return { type: 'FeatureCollection', features, source: 'GDELT 2.0 Events', updatedAt: new Date().toISOString() };
}

app.get('/api/feeds/gdelt', async (_req, res) => {
  try {
    if (gdeltCache && Date.now() - gdeltCacheTime < 5 * 60_000) return res.json(gdeltCache);
    if (!gdeltRequest) gdeltRequest = loadGdeltEvents();
    gdeltCache = await gdeltRequest;
    gdeltCacheTime = Date.now();
    log(`GDELT conflict events fetched: ${gdeltCache.features.length}`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(gdeltCache);
  } catch (error) {
    log(`public feed gdelt failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(502).json({ error: 'GDELT conflict events are unavailable.' });
  } finally {
    gdeltRequest = undefined;
  }
});

app.get('/api/feeds/adsb', async (_req, res) => {
  try {
    if (flightCache && Date.now() - flightCacheTime < 15000) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      return res.json(flightCache);
    }
    if (!flightRequest) flightRequest = loadAircraft();
    const result = await flightRequest;
    flightCache = result;
    flightCacheTime = Date.now();
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.json(result);
  } catch (error) {
    log(`public feed adsb failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(502).json({ error: 'Public ADS-B feeds are unavailable.' });
  } finally {
    flightRequest = undefined;
  }
});

app.get('/api/feeds/:name', async (req, res) => {
  const url = publicFeeds[req.params.name];
  if (!url) return res.status(404).json({ error: 'Unknown public feed.' });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    const data = await response.json();
    log(`public feed fetched: ${req.params.name}`);
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (error) {
    log(`public feed ${req.params.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(502).json({ error: `Public feed ${req.params.name} is unavailable.` });
  }
});

let statsCache;
let statsCacheTime = 0;
let statsRequest;

app.get('/api/system-stats', async (_req, res) => {
  try {
    let stats = statsCache;
    if (!stats || Date.now() - statsCacheTime >= 1000) {
      if (!statsRequest) {
        statsRequest = (async () => {
          // Fast path: Rust sysinfo sampler. Falls back to systeminformation.
          if (native.isEnabled()) {
            try {
              return await native.call('/system-stats', undefined, 3000);
            } catch (error) {
              log(`system stats native unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const [load, memory, battery, filesystems] = await Promise.all([si.currentLoad(), si.mem(), si.battery(), si.fsSize()]);
          const diskTotal = filesystems.reduce((sum, filesystem) => sum + (filesystem.size || 0), 0);
          const diskUsed = filesystems.reduce((sum, filesystem) => sum + (filesystem.used || 0), 0);
          return {
            cpuLoad: Math.round(load.currentLoad * 10) / 10,
            memoryLoad: memory.total ? Math.round((memory.used / memory.total) * 1000) / 10 : 0,
            memoryUsedGb: Math.round((memory.used / 1024 ** 3) * 10) / 10,
            memoryTotalGb: Math.round((memory.total / 1024 ** 3) * 10) / 10,
            diskLoad: diskTotal ? Math.round((diskUsed / diskTotal) * 1000) / 10 : 0,
            diskUsedGb: Math.round((diskUsed / 1024 ** 3) * 10) / 10,
            diskTotalGb: Math.round((diskTotal / 1024 ** 3) * 10) / 10,
            batteryPercent: battery.hasBattery ? battery.percent : null,
            batteryCharging: battery.hasBattery ? battery.isCharging : null,
            timestamp: new Date().toISOString(),
          };
        })();
      }
      try {
        stats = await statsRequest;
        statsCache = stats;
        statsCacheTime = Date.now();
        log('system metrics sampled');
      } finally {
        statsRequest = undefined;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(stats);
  } catch (error) {
    log(`system metrics failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(503).json({ error: 'System telemetry unavailable.' });
  }
});

app.get('/api/network-scan', async (_req, res) => {
  try {
    const rows = Object.entries(os.networkInterfaces()).flatMap(([iface, addresses]) => {
      const ipv4 = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
      if (!ipv4) return [];
      return [{
        iface,
        type: /wi-?fi|wireless|wlan|802[.]11/i.test(iface) ? 'wireless' : 'wired',
        ip4: ipv4.address,
        operstate: 'UP',
        speed: 0,
      }];
    });
    log(`local network interfaces enumerated: ${rows.length}`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ interfaces: rows });
  } catch (error) {
    log(`network interface scan failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(503).json({ error: 'Local network interfaces unavailable.' });
  }
});

app.get('/api/logs', (_req, res) => res.json({ logs: [...logs] }));

app.post('/api/restart', (req, res) => {
  const origin = req.get('origin');
  const address = req.socket.remoteAddress || '';
  const isLoopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  if (!isLoopback || (origin && !allowedOrigins.has(origin))) {
    return res.status(403).json({ error: 'Restart is available only to the local KRYNARA console.' });
  }
  log('local gateway restart requested');
  res.status(202).json({ message: 'Gateway restarting; it will be available again shortly.' });
  setTimeout(() => {
    const child = spawn(process.execPath, [__filename], {
      cwd: process.cwd(),
      env: { ...process.env, KRYNARA_RESTART_DELAY_MS: '1000' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', (error) => log(`restart failed: ${error.message}`));
    child.unref();
    serverRef.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  }, 250);
});

app.post('/api/proxies/refresh', (_req, res) => {
  res.json({
    lastRefreshed: new Date().toISOString(),
    totalCount: 6,
    workingCount: 5,
  });
});

app.use((error, _req, res, _next) => {
  log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  res.status(500).json({ error: 'Gateway request failed.' });
});

let serverRef;
const restartDelay = Number(process.env.KRYNARA_RESTART_DELAY_MS || 0);
const startGateway = () => {
  log(`API Keys loaded: nvidia ${Boolean(keysRoute.getApiKey('NV_API_KEY'))}, openrouter ${Boolean(keysRoute.getApiKey('OPENROUTER_API_KEY'))}, tavily ${Boolean(keysRoute.getApiKey('TAVILY_API_KEY'))}`);
  serverRef = server.listen(port, '127.0.0.1', () => log(`KRYNARA local gateway listening on http://127.0.0.1:${port}`));
  whatsapp.attachKrynaraWhatsAppWs(serverRef);
  serverRef.on('error', (error) => {
    log(`gateway startup failed: ${error.message}`);
    process.exitCode = 1;
  });
};
if (restartDelay > 0) setTimeout(startGateway, restartDelay);
else startGateway();

// Shut down cleanly so children (Telegram bridge, native sidecar) are not left
// orphaned holding ports 2787/2790 — Windows does not kill children on parent
// exit, so without this every restart leaks processes and hits EADDRINUSE.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}; shutting down`);
  try { native.stop(); } catch { /* best effort */ }
  try { if (serverRef) serverRef.close(); } catch { /* best effort */ }
  // Give the OS a moment to release sockets before exit.
  setTimeout(() => process.exit(0), 500).unref?.();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
