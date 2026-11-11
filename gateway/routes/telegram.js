/**
 * KRYNARA gateway <-> Social Hub Telegram bridge.
 * Forwards /api/telegram/* to the real TDLib bridge (node socialhub-server.js
 * in D:\Refrences and Codes\tweb, port 2787). Connected means ONLY that TDLib
 * reports authorizationStateReady — never just "keys typed".
 */
const TWEB_BRIDGE = 'http://127.0.0.1:2787';
const TWEB_DIR = 'D:\\Refrences and Codes\\tweb';

// BUG 3 FIX: the bridge (node socialhub-server.js, port 2787) previously had
// to be started by hand — every poll produced a hard 502. Auto-start it once
// per gateway boot if it is down, then retry the forwarded request.
let bridgeSpawning = false;
let bridgeSpawned = false;
function ensureBridge() {
  if (bridgeSpawned || bridgeSpawning) return;
  bridgeSpawning = true;
  try {
    const fs = require('node:fs');
    if (!fs.existsSync(require('node:path').join(TWEB_DIR, 'socialhub-server.js'))) {
      console.warn('[telegram] bridge script not found at', TWEB_DIR);
      return;
    }
    const child = require('node:child_process').spawn(process.execPath, ['socialhub-server.js'], {
      cwd: TWEB_DIR,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => process.stdout.write(`[tweb] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[tweb] ${d}`));
    child.on('exit', (code) => {
      console.warn(`[telegram] bridge exited (${code}); will not auto-restart until gateway restart.`);
      bridgeSpawned = false;
    });
    bridgeSpawned = true;
    console.log('[telegram] TDLib bridge auto-started on port 2787.');
  } catch (err) {
    console.warn('[telegram] bridge auto-start failed:', err && err.message ? err.message : err);
  } finally {
    setTimeout(() => { bridgeSpawning = false; }, 5000);
  }
}

async function bridgeUp() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => controllerAbort(c), 1500);
    const res = await fetch(TWEB_BRIDGE + '/api/state', { signal: c.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}
function controllerAbort(controller) { try { controller.abort(); } catch { /* noop */ } }

async function forward(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(TWEB_BRIDGE + path, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    // BUG 3 FIX: first failure auto-starts the bridge and retries once before
    // surfacing the real error (still 502, but only when truly offline).
    if (!bridgeSpawned) {
      ensureBridge();
      for (let i = 0; i < 20 && !(await bridgeUp()); i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (await bridgeUp()) return forward(path, init);
    }
    return {
      status: 502,
      body: {
        error: 'Telegram bridge offline — starting it now, retry in ~10 seconds.',
        detail: String(err && err.message ? err.message : err),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  register(app) {
    // Single source of truth for "is Telegram really connected":
    app.get('/api/telegram/status', async (_req, res) => {
      const { status, body } = await forward('/api/state');
      res.status(status).json({
        configured: body.configured ?? false,
        authorized: body.authorized ?? false,
        connected: body.authorized ?? false, // explicit: Connected ONLY on TDLib Ready
        state: body.state ?? 'idle',
        user: body.user ?? null,
        proxy: body.proxy ?? { type: 'none' },
        chats_count: Array.isArray(body.chats) ? body.chats.length : 0,
        bridgeOnline: status === 200,
      });
    });

    app.post('/api/telegram/send-code', async (req, res) => {
      const r = await forward('/api/telegram/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: req.body?.value ?? req.body?.phone }),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/verify-code', async (req, res) => {
      const r = await forward('/api/telegram/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: req.body?.value ?? req.body?.code }),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/password', async (req, res) => {
      const r = await forward('/api/telegram/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: req.body?.value ?? req.body?.password }),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/logout', async (_req, res) => {
      const r = await forward('/api/logout', { method: 'POST' });
      res.status(r.status).json(r.body);
    });

    app.get('/api/telegram/chats', async (_req, res) => {
      const r = await forward('/api/chats');
      res.status(r.status).json(r.body);
    });

    app.get('/api/telegram/messages/:id', async (req, res) => {
      const r = await forward(`/api/history/${encodeURIComponent(req.params.id)}`);
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/send', async (req, res) => {
      const r = await forward('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: req.body?.chatId, text: req.body?.text }),
      });
      res.status(r.status).json(r.body);
    });

    // SETTINGS BUG FIX: the tweb bridge never implemented /api/telegram/proxy,
    // so every save failed and Settings reset to None on refresh. The bridge
    // DOES load config/telegram-proxy.json at boot (src/telegram/config.js), so
    // persist the proxy to that exact file here and serve it back on GET.
    const TWEB_PROXY_FILE = require('node:path').join(TWEB_DIR, 'config', 'telegram-proxy.json');
    const PROXY_DEFAULTS = { type: 'none', host: '', port: '', username: '', password: '', secret: '' };
    const readProxyFile = () => {
      try {
        if (require('node:fs').existsSync(TWEB_PROXY_FILE)) {
          const data = JSON.parse(require('node:fs').readFileSync(TWEB_PROXY_FILE, 'utf8'));
          return { ...PROXY_DEFAULTS, ...data };
        }
      } catch { /* fall through to defaults */ }
      return { ...PROXY_DEFAULTS };
    };

    app.post('/api/telegram/proxy', async (req, res) => {
      const body = req.body ?? {};
      const type = ['none', 'socks5', 'mtproto'].includes(body.type) ? body.type : 'none';
      const proxy = {
        type,
        host: String(body.host || ''),
        port: String(body.port || ''),
        username: String(body.username || ''),
        password: String(body.password || ''),
        secret: String(body.secret || ''),
      };
      if (type !== 'none' && (!proxy.host || !proxy.port)) {
        return res.status(400).json({ error: 'host and port are required for a proxy.' });
      }
      if (type === 'mtproto' && !proxy.secret) {
        return res.status(400).json({ error: 'MTProto proxies need a secret.' });
      }
      try {
        require('node:fs').mkdirSync(require('node:path').dirname(TWEB_PROXY_FILE), { recursive: true });
        require('node:fs').writeFileSync(TWEB_PROXY_FILE, JSON.stringify(proxy, null, 2));
      } catch (error) {
        return res.status(500).json({ error: `Could not write proxy config: ${error instanceof Error ? error.message : String(error)}` });
      }
      res.json({ saved: true, proxy, note: 'Saved to config/telegram-proxy.json. Restart the Telegram bridge so TDLib reloads the route.' });
    });

    app.get('/api/telegram/proxy', (_req, res) => {
      res.json(readProxyFile());
    });

    app.post('/api/telegram/test-proxy', async (req, res) => {
      const r = await forward('/api/telegram/test-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/connect', async (_req, res) => {
      const r = await forward('/api/connect', { method: 'POST' });
      res.status(r.status).json(r.body);
    });
  },
};
