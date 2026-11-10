/**
 * KRYNARA key store — user's OWN API accounts (never fake keys).
 * Persisted to <KRYNARA_STORAGE_ROOT>/config/keys.json; never committed to git.
 */
const fs = require('node:fs');
const path = require('node:path');
const { STORAGE_ROOT } = require('../lib/storage-path');

const KEY_DIR = path.join(STORAGE_ROOT, 'config');
const KEY_FILE = path.join(KEY_DIR, 'keys.json');
const REPO_ROOT = path.join(__dirname, '..', '..');
const ENV_FILES = [
  path.join(REPO_ROOT, '.env'),
  path.join(REPO_ROOT, '.env.local'),
  path.join(REPO_ROOT, 'gateway', '.env.local'),
  path.join(REPO_ROOT, 'console', '.env'),
  path.join(REPO_ROOT, 'console', '.env.local'),
];

const KEY_REGISTRY = [
  { id: 'NV_API_KEY', envKeys: ['NV_API_KEY', 'NVIDIA_NIM_API_KEY', 'NVIDIA_API_KEY', 'VITE_NVIDIA_API_KEY', 'VITE_NVIDIA_NIM_API_KEY', 'nvidia_api_key', 'vite_nvidia_api_key'], label: 'NVIDIA NIM (build.nvidia.com)', url: 'https://build.nvidia.com', scope: 'chat, image, video, audio, vision' },
  { id: 'GROQ_API_KEY', envKeys: ['GROQ_API_KEY', 'VITE_GROQ_API_KEY'], label: 'Groq', url: 'https://console.groq.com/keys', scope: 'online chat' },
  { id: 'OPENROUTER_API_KEY', envKeys: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'VITE_OPENROUTER_API_KEY'], label: 'OpenRouter', url: 'https://openrouter.ai/keys', scope: 'online chat' },
  { id: 'TAVILY_API_KEY', envKeys: ['TAVILY_API_KEY', 'VITE_TAVILY_API_KEY'], label: 'Tavily Search', url: 'https://tavily.com', scope: 'web search' },
  { id: 'VITE_CESIUM_ION_TOKEN', envKeys: ['VITE_CESIUM_ION_TOKEN', 'CESIUM_ION_TOKEN'], label: 'Cesium ion (cesium.com)', url: 'https://cesium.com/ion/tokens', scope: '3D terrain, satellite, buildings' },
  { id: 'VITE_OPENWEATHER_API_KEY', envKeys: ['VITE_OPENWEATHER_API_KEY', 'OPENWEATHER_API_KEY'], label: 'OpenWeatherMap', url: 'https://home.openweathermap.org/api_keys', scope: 'thermal, wind, precipitation layers' },
  { id: 'VITE_MAPBOX_TOKEN', envKeys: ['VITE_MAPBOX_TOKEN', 'MAPBOX_TOKEN'], label: 'Mapbox', url: 'https://account.mapbox.com/access-tokens/', scope: 'satellite basemap fallback' },
  { id: 'VITE_ELEVENLABS_API_KEY', envKeys: ['VITE_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY'], label: 'ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys', scope: 'British TTS audio' },
  { id: 'VITE_OPENSKY_USER', envKeys: ['VITE_OPENSKY_USER', 'OPENSKY_USER'], label: 'OpenSky Network', url: 'https://opensky-network.org/', scope: 'live plane telemetry' },
  { id: 'TELEGRAM_API_ID', envKeys: ['TELEGRAM_API_ID', 'TELEGRAM_API_ID_'], label: 'Telegram API ID (my.telegram.org)', url: 'https://my.telegram.org', scope: 'real messaging — API development tools' },
  { id: 'TELEGRAM_API_HASH', envKeys: ['TELEGRAM_API_HASH'], label: 'Telegram API Hash (my.telegram.org)', url: 'https://my.telegram.org', scope: 'real messaging — secret hash' },
];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(store, null, 2));
}

function readEnvValues(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return Object.fromEntries(
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map(([, name, value]) => [name, value.replace(/^(['"])(.*)\1$/, '$2')]),
    );
  } catch (error) {
    console.warn(`Could not read local environment file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function getApiKey(id) {
  const entry = KEY_REGISTRY.find((item) => item.id === id);
  if (!entry) return '';
  const stored = readStore()[id];
  if (typeof stored === 'string' && stored.trim()) return stored.trim();
  for (const name of entry.envKeys) {
    if (typeof process.env[name] === 'string' && process.env[name].trim()) return process.env[name].trim();
  }
  for (const file of ENV_FILES) {
    const values = readEnvValues(file);
    for (const name of entry.envKeys) {
      if (typeof values[name] === 'string' && values[name].trim()) return values[name].trim();
    }
  }
  return '';
}

function mask(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

module.exports = {
  register(app) {
    app.get('/api/keys', (_req, res) => {
      res.json({
        keys: KEY_REGISTRY.map(({ id, label, url, scope }) => ({
          id, label, url, scope,
          connected: Boolean(getApiKey(id)),
          masked: mask(getApiKey(id)),
        })),
        file: KEY_FILE,
      });
    });

    app.post('/api/keys/:id', (req, res) => {
      const entry = KEY_REGISTRY.find((item) => item.id === req.params.id);
      if (!entry) return res.status(404).json({ error: 'Unknown key id.' });
      const value = String(req.body?.value ?? '').trim();
      if (!value) return res.status(400).json({ error: 'value required.' });
      const store = readStore();
      store[entry.id] = value;
      writeStore(store);
      res.json({ saved: entry.id, masked: mask(value) });
    });

    app.delete('/api/keys/:id', (req, res) => {
      const store = readStore();
      delete store[req.params.id];
      writeStore(store);
      res.json({ removed: req.params.id });
    });

    // Internal resolver for other gateway routes
    app.locals.getApiKey = getApiKey;
  },
  KEY_REGISTRY,
  getApiKey,
};
