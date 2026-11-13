/**
 * KRYNARA gateway <-> Social Hub Telegram bridge.
 * Forwards /api/telegram/* to the real TDLib bridge (node socialhub-server.js
 * in scripts/socialhub-server.js, port 2787).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TWEB_BRIDGE = 'http://127.0.0.1:2787';
const TWEB_DIR = path.resolve(__dirname, '..', 'scripts');

let bridgeSpawning = false;
let bridgeSpawned = false;

function ensureBridge() {
  if (bridgeSpawned || bridgeSpawning) return;
  bridgeSpawning = true;
  try {
    const scriptPath = path.join(TWEB_DIR, 'socialhub-server.js');
    if (!fs.existsSync(scriptPath)) {
      console.warn('[telegram] bridge script not found at', TWEB_DIR);
      bridgeSpawning = false;
      return;
    }
    const child = spawn(process.execPath, ['socialhub-server.js'], {
      cwd: TWEB_DIR,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '2787' },
    });

    child.stdout.on('data', (d) => process.stdout.write(`[tweb] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[tweb] ${d}`));
    child.on('exit', (code) => {
      console.warn(`[telegram] bridge exited (${code}); ready to respawn if requested.`);
      bridgeSpawned = false;
    });

    bridgeSpawned = true;
    console.log('[telegram] TDLib bridge auto-started on port 2787.');
  } catch (err) {
    console.warn('[telegram] bridge auto-start failed:', err && err.message ? err.message : err);
  } finally {
    setTimeout(() => { bridgeSpawning = false; }, 3000);
  }
}

// Auto-start the bridge at gateway boot
ensureBridge();

async function bridgeUp() {
  try {
    const res = await fetch(TWEB_BRIDGE + '/api/state', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function forward(subPath, init) {
  try {
    const res = await fetch(TWEB_BRIDGE + subPath, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    if (!bridgeSpawned) {
      ensureBridge();
      for (let i = 0; i < 6 && !(await bridgeUp()); i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (await bridgeUp()) return forward(subPath, init);
    }
    return {
      status: 502,
      body: {
        error: 'Telegram bridge offline — starting it now, retry in a moment.',
        detail: String(err && err.message ? err.message : err),
      },
    };
  }
}

module.exports = {
  register(app) {
    // Single source of truth for Telegram status
    app.get('/api/telegram/status', async (_req, res) => {
      const { status, body } = await forward('/api/state');
      res.status(status).json({
        configured: body.configured ?? false,
        authorized: body.authorized ?? false,
        connected: body.authorized ?? false,
        state: body.state ?? 'idle',
        user: body.user ?? null,
        proxy: body.proxy ?? { enabled: false, type: 'none' },
        chats_count: body.chats_count ?? 0,
        bridgeOnline: status === 200,
      });
    });

    app.post('/api/telegram/connect', async (_req, res) => {
      const r = await forward('/api/connect', { method: 'POST' });
      res.status(r.status).json(r.body);
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
        body: JSON.stringify({ chatId: req.body?.chatId, text: req.body?.text, replyToId: req.body?.replyToId }),
      });
      res.status(r.status).json(r.body);
    });

    // Message Actions
    app.post('/api/telegram/reply', async (req, res) => {
      const r = await forward('/api/telegram/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/edit', async (req, res) => {
      const r = await forward('/api/telegram/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/delete', async (req, res) => {
      const r = await forward('/api/telegram/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/pin', async (req, res) => {
      const r = await forward('/api/telegram/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/forward', async (req, res) => {
      const r = await forward('/api/telegram/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/react', async (req, res) => {
      const r = await forward('/api/telegram/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/callback-query', async (req, res) => {
      const r = await forward('/api/telegram/callback-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    // File Downloads & Media Streaming
    app.post('/api/telegram/download', async (req, res) => {
      const r = await forward('/api/telegram/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.get('/api/telegram/file-status/:id', async (req, res) => {
      const r = await forward(`/api/telegram/file-status/${encodeURIComponent(req.params.id)}`);
      res.status(r.status).json(r.body);
    });

    app.get('/api/telegram/file/:id', (req, res) => {
      const fileUrl = `${TWEB_BRIDGE}/api/telegram/file/${encodeURIComponent(req.params.id)}`;
      const request = http.get(fileUrl, (bridgeRes) => {
        res.writeHead(bridgeRes.statusCode || 200, bridgeRes.headers);
        bridgeRes.pipe(res);
      });
      request.on('error', () => {
        res.status(502).json({ error: 'Failed to retrieve media file from bridge' });
      });
    });

    app.post('/api/telegram/open-file', async (req, res) => {
      const r = await forward('/api/telegram/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    // Groups & Channels
    app.post('/api/telegram/create-group', async (req, res) => {
      const r = await forward('/api/telegram/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/create-channel', async (req, res) => {
      const r = await forward('/api/telegram/create-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    // Proxy Module
    app.get('/api/telegram/proxy', async (_req, res) => {
      const r = await forward('/api/telegram/proxy');
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

    app.post('/api/telegram/proxy/toggle', async (req, res) => {
      const r = await forward('/api/telegram/proxy/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      res.status(r.status).json(r.body);
    });

    app.post('/api/telegram/proxy/auto', async (req, res) => {
      const r = await forward('/api/telegram/proxy/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
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

    // Real-Time SSE Event Stream Proxy
    app.get('/api/telegram/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const bridgeReq = http.get(`${TWEB_BRIDGE}/api/events`, (bridgeRes) => {
        bridgeRes.on('data', (chunk) => res.write(chunk));
        bridgeRes.on('end', () => res.end());
      });

      bridgeReq.on('error', () => {
        res.write('data: {"kind":"error","message":"Bridge stream disconnected"}\n\n');
        setTimeout(() => res.end(), 1000);
      });

      req.on('close', () => {
        bridgeReq.destroy();
      });
    });
  },
};
