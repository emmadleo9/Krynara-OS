// Social Hub â€” Telegram web bridge (REAL TDLib + proxy support).
// Zero-dependency HTTP server exposing the real TDLib client to the UI and
// to the Krynara gateway (/api/telegram/* proxies here).
// Run: node socialhub-server.js  (default port 2787)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import TelegramAuth from './src/telegram/auth.js';
import TelegramChats from './src/telegram/chats.js';
import TelegramMessages from './src/telegram/messages.js';
import { loadTelegramConfig, loadProxyConfig, saveProxyConfig } from './src/telegram/config.js';

const PORT = Number(process.env.PORT || 2787);
const PUBLIC_DIR = path.resolve(process.cwd(), 'public-socialhub');

let auth = null, chats = null, messages = null;
let booted = false, booting = null;
let lastAuthState = 'idle';           // last TDLib authorization state seen
const sseClients = new Set();

const log = (m) => console.log(`[SocialHub TG] ${m}`);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function broadcast(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) { try { res.write(data); } catch { sseClients.delete(res); } }
}

function statusBody() {
  return {
    configured: Boolean(loadTelegramConfig().apiId),
    booted,
    state: auth ? (auth.ready ? 'ready' : lastAuthState) : lastAuthState,
    authorized: Boolean(auth && auth.ready),
    user: auth && auth.me
      ? { first_name: auth.me.first_name, last_name: auth.me.last_name, username: auth.me.username, id: String(auth.me.id) }
      : null,
    proxy: loadProxyConfig(),
    chats: chats ? chats.getAllChats() : [],
  };
}

async function boot() {
  if (booted) return;
  if (booting) return booting;
  const config = loadTelegramConfig();
  if (!config.apiId || !config.apiHash) {
    throw new Error('Telegram API ID/Hash missing. Add them in Krynara Settings first.');
  }
  booting = (async () => {
    auth = new TelegramAuth({ apiId: config.apiId, apiHash: config.apiHash, onLog: log });
    chats = new TelegramChats(auth.client);
    chats.onLog = log;
    messages = new TelegramMessages(auth.client, chats);
    messages.onLog = log;
    messages.onMessage = (chatId, msg) => broadcast({ kind: 'newMessage', chatId: String(chatId), message: slim(msg) });
    messages.onSent = (chatId, msg) => broadcast({ kind: 'sent', chatId: String(chatId), message: slim(msg) });
    chats.onChats = () => broadcast({ kind: 'chats', chats: chats.getAllChats() });
    lastAuthState = 'starting';

    // Update pump
    (async () => {
      while (true) {
        const u = await auth.client.receive(0.5);
        if (!u) continue;
        if (u['@type'] === 'updateAuthorizationState') {
          lastAuthState = u.authorization_state['@type'].replace('authorizationState', '').toLowerCase();
          broadcast({ kind: 'authState', state: u.authorization_state['@type'] });
        }
        await auth.handle(u);
        chats.handle(u);
        messages.handle(u);
      }
    })().catch((e) => { console.error('Pump crashed:', e); });

    // PROXY must be applied BEFORE setTdlibParameters for reliable routing.
    const proxy = loadProxyConfig();
    if (proxy.type && proxy.type !== 'none') {
      log(`Applying proxy: ${proxy.type} ${proxy.host}:${proxy.port}`);
      const type = proxy.type === 'mtproto'
        ? { '@type': 'proxyTypeMtproto', secret: proxy.secret || '' }
        : { '@type': 'proxyTypeSocks5', username: proxy.username || '', password: proxy.password || '' };
      const added = await auth.client.sendAndWait({
        '@type': 'addProxy',
        server: proxy.host,
        port: Number(proxy.port),
        enable: true,
        type,
      }, 10000).catch((e) => { log(`addProxy failed: ${e.message}`); return null; });
      if (added && added['@type'] === 'proxy' && proxy.type !== 'mtproto') {
        // Some builds need an explicit enable after add.
        await auth.client.sendAndWait({ '@type': 'enableProxy', proxy_id: added.id }, 10000).catch(() => {});
      }
      // Verify the route actually works (testProxy returns a timing or error).
      const test = await auth.client.sendAndWait({ '@type': 'testProxy', server: proxy.host, port: Number(proxy.port), type }, 15000).catch(() => null);
      log(test && test['@type'] !== 'error' ? 'Proxy reachable.' : 'Proxy test FAILED â€” connection may not work.');
    }

    await auth.start();

    // Blocked-country watchdog: if TDLib cannot reach a DC within 10s and
    // no auth step is even offered, the DC is probably blocked.
    const startAt = Date.now();
    const watchdog = setInterval(() => {
      if (auth.ready || lastAuthState === 'waitphonenumber' || lastAuthState === 'ready') { clearInterval(watchdog); return; }
      if (Date.now() - startAt > 10000 && !proxy.type) {
        clearInterval(watchdog);
        broadcast({
          kind: 'authError',
          error: 'Telegram DC blocked in your country. Turn on Proxy in Settings > Telegram',
        });
        log('Connection watchdog: DC unreachable without proxy.');
      }
    }, 1000);

    booted = true;
  })();
  return booting;
}

function slim(m) {
  return {
    id: m.id,
    chat_id: m.chat_id,
    is_outgoing: m.is_outgoing,
    date: m.date,
    sender: m.sender_id && m.sender_id.user_id ? m.sender_id.user_id : null,
    text: m.content && m.content['@type'] === 'messageText' ? m.content.text.text : '[non-text]',
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function handleApi(req, res, p) {
  if (p === '/api/state' || p === '/api/telegram/status') {
    return json(res, 200, statusBody());
  }
  if (p === '/api/connect' && req.method === 'POST') {
    await boot();
    return json(res, 200, statusBody());
  }
  // Explicit endpoints required by the spec:
  if (p === '/api/telegram/send-code' && req.method === 'POST') {
    // Step 1: submit phone number (TDLib then sends the login code).
    await boot();
    const { value } = await readBody(req);
    await auth.sendPhoneNumber(value);
    return json(res, 200, { ok: true, next: 'verify-code' });
  }
  if (p === '/api/telegram/verify-code' && req.method === 'POST') {
    // Step 2: submit login code (then 2FA password if enabled).
    const { value } = await readBody(req);
    try {
      await auth.sendCode(value);
    } catch (err) {
      // TDLib reports PASSWORD_NEEDED as an error on checkAuthenticationCode.
      if (err.tdlibError && /PASSWORD/i.test(err.tdlibError.message)) {
        return json(res, 200, { ok: true, next: 'password' });
      }
      throw err;
    }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/telegram/password' && req.method === 'POST') {
    const { value } = await readBody(req);
    await auth.sendPassword(value);
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/login/')) {
    const kind = p.split('/').pop();
    const { value } = await readBody(req);
    if (!value) return json(res, 400, { error: 'value required' });
    if (kind === 'phone') await auth.sendPhoneNumber(value);
    else if (kind === 'code') await auth.sendCode(value);
    else if (kind === 'password') await auth.sendPassword(value);
    else return json(res, 400, { error: 'unknown kind' });
    return json(res, 200, { ok: true });
  }
  if (p === '/api/logout' || p === '/api/telegram/logout') {
    await boot().catch(() => {});
    if (auth) await auth.logout();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/telegram/proxy' && req.method === 'POST') {
    const body = await readBody(req);
    saveProxyConfig(body);
    log(Proxy saved: . Restart the bridge to apply it to TDLib.);
    return json(res, 200, { ok: true, proxy: loadProxyConfig(), note: 'Restart node socialhub-server.js to apply.' });
  }
  if (p === '/api/telegram/proxy' && req.method === 'GET') {
    return json(res, 200, loadProxyConfig());
  }
  if (p === '/api/telegram/test-proxy' && req.method === 'POST') {
    const { type, host, port, username, password, secret } = await readBody(req);
    if (!auth) {
      // spin up a bare client just for the proxy test
      const probe = new (await import('./src/telegram/client.js')).default();
      const t = type === 'mtproto' ? { '@type': 'proxyTypeMtproto', secret: secret || '' } : { '@type': 'proxyTypeSocks5', username: username || '', password: password || '' };
      await probe.sendAndWait({ '@type': 'addProxy', server: host, port: Number(port), enable: true, type: t }, 10000);
      const result = await probe.sendAndWait({ '@type': 'testProxy', server: host, port: Number(port), type: t }, 20000);
      probe.close();
      return json(res, 200, { ok: result && result['@type'] !== 'error', detail: result && result['@type'] === 'error' ? result.message : 'proxy reachable' });
    }
    const t = type === 'mtproto' ? { '@type': 'proxyTypeMtproto', secret: secret || '' } : { '@type': 'proxyTypeSocks5', username: username || '', password: password || '' };
    const result = await auth.client.sendAndWait({ '@type': 'testProxy', server: host, port: Number(port), type: t }, 20000);
    return json(res, 200, result && result['@type'] === 'error' ? { ok: false, detail: result.message } : { ok: true, detail: 'proxy reachable' });
  }
  if (p === '/api/chats' || p === '/api/telegram/chats') {
    await boot();
    if (!auth.ready) return json(res, 409, { error: 'Not connected yet.', state: lastAuthState });
    const list = await chats.listChats(50);
    return json(res, 200, { chats: list });
  }
  if ((p.startsWith('/api/history/') || p.startsWith('/api/telegram/messages/'))) {
    await boot();
    if (!auth.ready) return json(res, 409, { error: 'Not connected yet.', state: lastAuthState });
    const chatId = BigInt(p.split('/').pop());
    const msgs = await messages.getHistory(chatId, 30);
    return json(res, 200, { messages: msgs.map(slim).reverse() });
  }
  if (p === '/api/send' || p === '/api/telegram/send') {
    await boot();
    if (!auth.ready) return json(res, 409, { error: 'Not connected yet.', state: lastAuthState });
    const { chatId, text } = await readBody(req);
    const sent = await messages.sendMessage(BigInt(chatId), text);
    return json(res, 200, { ok: true, message: sent ? slim(sent) : null });
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', ...CORS });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return true; // handled â€” response stays open
  }
  return null; // not an API route
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  try {
    const handled = await handleApi(req, res, p);
    if (handled !== null) return;
    // Static UI
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return json(res, 404, { error: 'not found' });
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (err) {
    log(`ERROR ${p}: ${err.message}`);
    json(res, 500, { error: err.message, tdlib: err.tdlibError || null });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`Social Hub Telegram web bridge on http://127.0.0.1:${PORT}`));

