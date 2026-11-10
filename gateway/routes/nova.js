/**
 * NOVA NEXUS relay — proxies the user's NVIDIA NIM account for chat/image/vision.
 * Image + chat requests stream back JSON; key stays server-side.
 */
const fs = require('node:fs');
const path = require('node:path');
const keys = require('./keys');
const { STORAGE_ROOT } = require('../lib/storage-path');

const MAX_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;
const KRYNARA_STORAGE_ROOT = STORAGE_ROOT;
const NIM_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_IMAGE_BASE = 'https://ai.api.nvidia.com/v1/genai';

const CHAT_MODELS = [
  { id: 'meta/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', vision: true },
  { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Nemotron Ultra 253B' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B' },
  { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2' },
  { id: 'mistralai/mixtral-8x22b-v0.1', name: 'Mixtral 8x22B' },
  { id: 'nv-mistralai/mistral-nemo-12b-instruct', name: 'Mistral Nemo 12B' },
];

const IMAGE_MODELS = [
  { id: 'black-forest-labs/flux.1-dev', name: 'Flux.1 Dev' },
  { id: 'stabilityai/stable-diffusion-3-medium', name: 'Stable Diffusion 3 Medium' },
  { id: 'stabilityai/stable-diffusion-xl', name: 'Stable Diffusion XL' },
];

function providerError(data) {
  const candidate = data?.detail ?? data?.error?.message ?? data?.error ?? data?.message ?? data?.title;
  return typeof candidate === 'string' ? candidate.slice(0, 1000) : '';
}

function isUnavailableModel(status, message) {
  if ([404, 410, 484].includes(status)) return true;
  return (status === 400 || status === 403) &&
    /model.{0,40}(not found|unavailable|unsupported|not supported|not enabled|not allowed|access denied|not entitled)|(?:not found|unavailable|unsupported|not supported|not enabled|not allowed|not entitled).{0,40}model|account.{0,40}(support|access|entitle)/i.test(message);
}

let imageGenerationInProgress = false;

function directoryBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile()) return total + fs.statSync(entryPath).size;
    if (entry.isDirectory()) return total + directoryBytes(entryPath);
    return total;
  }, 0);
}

module.exports = {
  CHAT_MODELS,
  IMAGE_MODELS,
  register(app) {
    app.get('/api/nova/models', (_req, res) => {
      res.json({ chat: CHAT_MODELS, image: IMAGE_MODELS, nexus: Boolean(keys.getApiKey('NV_API_KEY')) });
    });

    app.post('/api/nova/chat', async (req, res) => {
      const apiKey = keys.getApiKey('NV_API_KEY');
      if (!apiKey) return res.status(401).json({ error: 'Connect your NVIDIA NIM account in Settings first.' });
      const { model, messages, maxTokens } = req.body ?? {};
      if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required.' });
      try {
        const response = await fetch(`${NIM_BASE}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ model: model || CHAT_MODELS[0].id, messages: messages.slice(-16), max_tokens: Math.min(Number(maxTokens) || 1024, 2048), temperature: 0.7 }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ error: data.detail || data.title || `NIM HTTP ${response.status}` });
        res.json({ reply: data.choices?.[0]?.message?.content ?? '', model: data.model });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post('/api/nova/image', async (req, res) => {
      if (imageGenerationInProgress) {
        return res.status(429).json({ error: 'An image is already generating. Wait for it to finish before starting another.' });
      }
      const apiKey = typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()
        ? req.body.apiKey.trim()
        : keys.getApiKey('NV_API_KEY');
      if (!apiKey) return res.status(401).json({ error: 'Connect your NVIDIA NIM account in Settings first.' });
      const { model, prompt, quality } = req.body ?? {};
      if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Enter an image prompt.' });
      if (prompt.length > 2000) return res.status(400).json({ error: 'Keep image prompts under 2,000 characters.' });
      const sizes = { draft: 512, hd: 1024, '4k': 1024 };
      const requestedModel = IMAGE_MODELS.some((item) => item.id === model) ? model : IMAGE_MODELS[0].id;
      const candidates = [requestedModel, ...IMAGE_MODELS.map((item) => item.id).filter((id) => id !== requestedModel)].slice(0, 3);
      imageGenerationInProgress = true;
      try {
        for (const candidate of candidates) {
          const response = await fetch(`${NIM_IMAGE_BASE}/${candidate}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ prompt: prompt.trim(), width: sizes[quality] ?? sizes.hd, height: sizes[quality] ?? sizes.hd, n: 1 }),
            signal: AbortSignal.timeout(35_000),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (isUnavailableModel(response.status, providerError(data))) continue;
            if (response.status === 401 || response.status === 403) {
              return res.status(502).json({ error: 'NVIDIA rejected the API key or account access. Check that the key is active and has image-model permissions.' });
            }
            if (response.status === 429) return res.status(429).json({ error: 'NVIDIA image rate limit or account quota reached. Wait briefly before retrying.' });
            return res.status(502).json({ error: `NVIDIA image generation failed (HTTP ${response.status}). Check the key and image-model access.` });
          }
          const image = data.artifacts?.[0]?.base64 || data.image || data.b64_json || null;
          if (!image) return res.status(502).json({ error: 'NVIDIA returned no image. Check model access and try another image model.' });
          const notice = quality === '4k' ? 'Image output is capped at 1024 x 1024 to avoid excessive load.' : undefined;
          return res.json({
            image,
            seed: data.seed ?? null,
            model: data.model || candidate,
            ...(candidate !== requestedModel ? { notice: `The requested image model was unavailable; switched to ${data.model || candidate}.` } : {}),
            ...(notice ? { qualityNotice: notice } : {}),
          });
        }
        return res.status(422).json({
          error: 'Your NVIDIA account could not access the selected image model or its lightweight fallbacks. Check image-model permissions or use a text model.',
        });
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return res.status(timedOut ? 504 : 502).json({
          error: timedOut ? 'NVIDIA image generation timed out. Use Draft/HD quality or try again later.' : 'Could not reach NVIDIA image generation. Check the gateway internet connection.',
        });
      } finally {
        imageGenerationInProgress = false;
      }
    });

    app.post('/api/nova/save', (req, res) => {
      const { kind, dataUrl, meta } = req.body ?? {};
      if (!['images', 'videos', 'audio', 'files'].includes(kind)) return res.status(400).json({ error: 'kind must be images|videos|audio|files' });
      const match = String(dataUrl ?? '').match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 data URL.' });
      const [, mime, base64] = match;
      const payload = Buffer.from(base64, 'base64');
      if (payload.length > MAX_QUOTA_BYTES) return res.status(413).json({ error: 'Generated file exceeds Krynara-OS 20GB storage quota.' });
      const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
      const dir = path.join(KRYNARA_STORAGE_ROOT, 'generations', kind);
      const metadata = JSON.stringify(meta ?? {}, null, 2);
      const requiredBytes = payload.length + Buffer.byteLength(metadata);
      try {
        const usedBytes = directoryBytes(KRYNARA_STORAGE_ROOT);
        if (usedBytes + requiredBytes >= MAX_QUOTA_BYTES) {
          return res.status(507).json({ error: 'Krynara-OS D: storage has reached its 20GB quota. Export or move data before saving more.' });
        }
      } catch (error) {
        return res.status(500).json({ error: `Could not verify Krynara-OS storage usage: ${error instanceof Error ? error.message : String(error)}` });
      }
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, `nova-${stamp}.${ext}`);
      fs.writeFileSync(file, payload);
      fs.writeFileSync(`${file}.json`, metadata);
      res.json({ saved: file });
    });

    app.get('/api/nova/gallery/:kind', (req, res) => {
      const kind = req.params.kind;
      if (!['images', 'videos', 'audio', 'files'].includes(kind)) return res.status(400).json({ error: 'bad kind' });
      const fs = require('node:fs');
      const dir = path.join(KRYNARA_STORAGE_ROOT, 'generations', kind);
      try {
        const files = fs.readdirSync(dir).filter((file) => !file.endsWith('.json')).slice(-60).reverse();
        res.json({ kind, files });
      } catch {
        res.json({ kind, files: [] });
      }
    });

    // OpenWeatherMap tile proxy — injects YOUR key server-side so it never reaches the browser
    app.get('/api/weather-tiles/:layer', (req, res) => {
      const layer = String(req.params.layer);
      if (!['temp_new', 'wind_new', 'precipitation_new', 'clouds_new', 'pressure_new'].includes(layer)) return res.status(400).json({ error: 'unknown layer' });
      const apiKey = app.locals.getApiKey('VITE_OPENWEATHER_API_KEY');
      if (!apiKey) return res.status(401).json({ error: 'Connect YOUR OpenWeatherMap account in Settings.' });
      res.json({ tileUrl: `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${apiKey}` });
    });

    // Serve generation galleries statically so <img src="/generations/images/..."> works from the console dev proxy
    app.get('/generations/:kind/:file', (req, res) => {
      const { kind, file } = req.params;
      if (!['images', 'videos', 'audio', 'files'].includes(kind) || file.includes('..')) return res.status(400).end();
      res.sendFile(path.join(KRYNARA_STORAGE_ROOT, 'generations', kind, file));
    });
  },
};
