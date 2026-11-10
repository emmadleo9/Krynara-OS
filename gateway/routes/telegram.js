/**
 * KRYNARA gateway <-> Social Hub Telegram bridge.
 * Forwards /api/telegram/* to the real TDLib bridge (node socialhub-server.js
 * in D:\Refrences and Codes\tweb, port 2787). Connected means ONLY that TDLib
 * reports authorizationStateReady — never just "keys typed".
 */
const TWEB_BRIDGE = 'http://127.0.0.1:2787';

async function forward(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(TWEB_BRIDGE + path, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    return {
      status: 502,
      body: {
        error: 'Telegram bridge unreachable. Start it: cd "D:\\Refrences and Codes\\tweb" ; node socialhub-server.js',
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

    app.post('/api/telegram/proxy', async (req, res) => {
      const r = await forward('/api/telegram/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.get('/api/telegram/proxy', async (_req, res) => {
      const r = await forward('/api/telegram/proxy');
      res.status(r.status).json(r.body);
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
