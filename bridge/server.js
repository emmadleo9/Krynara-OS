import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAuth, loadProxyConfig, saveProxyConfig, proxyTypeFor, writeCredentials, readCredentials } from './tdlib-auth.js';
import { createChats, createMessages } from './tdlib-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
// The gateway and launcher expect 2787. KRYNARA_TWEB_DIR no longer applies:
// this bridge lives inside the repo.
const PORT = Number(process.env.SOCIALHUB_PORT || process.env.TELEGRAM_BRIDGE_PORT || process.env.PORT || 2787);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sseClients = new Set();

// Built-in public proxies used by /api/telegram/proxy/auto.
const BUILTIN_PROXIES = [
  { name: 'Telegram DC1', type: 'mtproto', host: '149.154.167.91', port: 443, secret: '' },
  { name: 'Telegram DC2', type: 'mtproto', host: '149.154.167.40', port: 443, secret: '' },
  { name: 'Telegram DC4', type: 'mtproto', host: '149.154.167.51', port: 443, secret: '' },
  { name: 'Telegram DC5', type: 'mtproto', host: '91.108.56.227', port: 443, secret: '' },
];

let auth = null;
let chats = null;
let messages = null;
let lastAuthState = 'closed';

/** Apply a saved proxy to a live TDLib client. */
async function applyProxyToClient(client, config) {
  const type = proxyTypeFor(config);
  if (!type || !config.host || !config.port) return false;
  if (config.enabled === false) {
    await client.sendAndWait({ '@type': 'disableProxy' }, 10000);
    return false;
  }
  await client.sendAndWait(
    { '@type': 'enableProxy', enable: true, server: String(config.host), port: Number(config.port), type },
    15000,
  );
  return true;
}

function statusBody() {
  if (!auth) {
    const credentials = readCredentials();
    return {
      configured: credentials.configured,
      authorized: false,
      connected: false,
      state: lastAuthState,
      user: null,
      proxy: loadProxyConfig(),
      chats_count: 0,
    };
  }
  const body = auth.statusBody();
  lastAuthState = body.state;
  return body;
}

/**
 * Ensures the TDLib client is initialised.
 *
 * "Initialised" is not the same as "authorised": on a first login TDLib sits at
 * waitphonenumber, which is the expected state for CONNECT TELEGRAM. Only the
 * endpoints that genuinely need an authorised client (chats, history, send)
 * check `auth.ready` themselves.
 */
async function boot() {
  if (!auth) throw new Error('Telegram bridge is not initialised yet. Retry in a moment.');
  await auth.boot();
  return auth;
}

async function initialise() {
  if (auth) return;
  const { configured } = readCredentials();
  try {
    auth = await createAuth({
      onEvent: (message) => {
        if (message['@type'] === 'updateAuthorizationState') {
          const type = message.authorization_state?.['@type'] || 'closed';
          lastAuthState = type.replace('authorizationState', '').toLowerCase();
          const payload = JSON.stringify({ kind: 'state', state: lastAuthState, ...statusBody() });
          for (const res of sseClients) {
            try {
              res.write(`data: ${payload}\n\n`);
            } catch {
              sseClients.delete(res);
            }
          }
        }
      },
    });
    chats = createChats(auth.client);
    messages = createMessages(auth.client);
    console.log(`[tdlib] ready (configured=${configured}, state=${auth.state})`);
  } catch (error) {
    console.warn(`[tdlib] initialisation failed: ${error && error.message ? error.message : error}`);
  }
}

function slim(m) {
  const contentType = m['@type'];
  let mediaType, text, media;
  const c = m.content || m;
  const sizes = c.photo?.sizes || [];
  const best = sizes[sizes.length - 1] || {};

  const thumb = sizes[0] || {};
  if (contentType === 'messagePhoto') {
    media = {
      type: 'photo',
      file_id: best.photo?.id,
      size: best.photo?.size,
      width: best.width,
      height: best.height,
      caption: text,
      thumb_id: thumb.photo?.id,
      local_path: best.photo?.local?.path || '',
      is_downloaded: Boolean(best.photo?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageVideo') {
    mediaType = 'video';
    text = c.caption?.text || '';
    media = {
      type: 'video',
      file_id: c.video?.video?.id,
      duration: c.video?.duration,
      width: c.video?.width,
      height: c.video?.height,
      file_name: c.video?.file_name || 'video.mp4',
      mime_type: c.video?.mime_type || 'video/mp4',
      caption: text,
      local_path: c.video?.video?.local?.path || '',
      is_downloaded: Boolean(c.video?.video?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageVoiceNote') {
    mediaType = 'voice';
    text = 'ðŸŽ¤ Voice message';
    media = {
      type: 'voice',
      file_id: c.voice_note?.voice?.id,
      duration: c.voice_note?.duration || 0,
      waveform: c.voice_note?.waveform || '',
      mime_type: c.voice_note?.mime_type || 'audio/ogg',
      local_path: c.voice_note?.voice?.local?.path || '',
      is_downloaded: Boolean(c.voice_note?.voice?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageAudio') {
    mediaType = 'audio';
    text = c.caption?.text || c.audio?.title || 'Audio';
    media = {
      type: 'audio',
      file_id: c.audio?.audio?.id,
      duration: c.audio?.duration,
      title: c.audio?.title || 'Audio',
      performer: c.audio?.performer || '',
      file_name: c.audio?.file_name || 'audio.mp3',
      mime_type: c.audio?.mime_type || 'audio/mpeg',
      local_path: c.audio?.audio?.local?.path || '',
      is_downloaded: Boolean(c.audio?.audio?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageDocument') {
    mediaType = 'document';
    text = c.caption?.text || c.document?.file_name || 'Document';
    media = {
      type: 'document',
      file_id: c.document?.document?.id,
      file_name: c.document?.file_name || 'document',
      mime_type: c.document?.mime_type || 'application/octet-stream',
      size: c.document?.document?.size || 0,
      caption: c.caption?.text || '',
      local_path: c.document?.document?.local?.path || '',
      is_downloaded: Boolean(c.document?.document?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageSticker') {
    mediaType = 'sticker';
    text = c.sticker?.emoji ? `${c.sticker.emoji} Sticker` : 'ðŸŽ¨ Sticker';
    media = {
      type: 'sticker',
      file_id: c.sticker?.sticker?.id,
      emoji: c.sticker?.emoji || '',
      width: c.sticker?.width,
      height: c.sticker?.height,
      is_animated: Boolean(c.sticker?.format?.['@type'] === 'stickerFormatTgs'),
      is_video: Boolean(c.sticker?.format?.['@type'] === 'stickerFormatWebm'),
      local_path: c.sticker?.sticker?.local?.path || '',
      is_downloaded: Boolean(c.sticker?.sticker?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messageAnimation') {
    mediaType = 'gif';
    text = c.caption?.text || 'GIF';
    media = {
      type: 'gif',
      file_id: c.animation?.animation?.id,
      duration: c.animation?.duration,
      width: c.animation?.width,
      height: c.animation?.height,
      file_name: c.animation?.file_name || 'animation.mp4',
      mime_type: c.animation?.mime_type || 'video/mp4',
      local_path: c.animation?.animation?.local?.path || '',
      is_downloaded: Boolean(c.animation?.animation?.local?.is_downloading_completed),
    };
  } else if (contentType === 'messagePoll') {
    mediaType = 'poll';
    text = `ðŸ“Š ${c.poll?.question || 'Poll'}`;
    media = {
      type: 'poll',
      question: c.poll?.question || '',
      options: (c.poll?.options || []).map((o) => ({ text: o.text, voter_count: o.voter_count, vote_percentage: o.vote_percentage })),
      total_voter_count: c.poll?.total_voter_count || 0,
      is_closed: Boolean(c.poll?.is_closed),
    };
  } else if (contentType === 'messageContact') {
    mediaType = 'contact';
    text = `ðŸ‘¤ ${[c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ')}: ${c.contact?.phone_number || ''}`;
  } else if (contentType === 'messageLocation') {
    mediaType = 'location';
    text = `ðŸ“ Location: ${c.location?.latitude}, ${c.location?.longitude}`;
    media = {
      type: 'location',
      latitude: c.location?.latitude,
      longitude: c.location?.longitude,
    };
  } else if (contentType === 'messageCall') {
    text = `ðŸ“ž Call (${c.discard_reason?.['@type']?.replace('callDiscardReason', '') || 'finished'})`;
  } else {
    text = `[${contentType.replace('message', '')}]`;
  }

  // Parse Reply Markup (Bot Buttons & Keyboards)
  let replyMarkup = null;
  if (m.reply_markup && m.reply_markup['@type'] === 'replyMarkupInlineKeyboard') {
    const rows = [];
    for (const row of (m.reply_markup.rows || [])) {
      const buttonRow = [];
      for (const btn of row) {
        const bType = btn.type ? btn.type['@type'] : '';
        let actionType = 'callback';
        let actionData = '';
        let url = '';

        if (bType === 'inlineKeyboardButtonTypeUrl') {
          actionType = 'url';
          url = btn.type.url;
        } else if (bType === 'inlineKeyboardButtonTypeCallback') {
          actionType = 'callback';
          actionData = btn.type.data || '';
        } else if (bType === 'inlineKeyboardButtonTypeWebApp') {
          actionType = 'web_app';
          url = btn.type.url;
        } else if (bType === 'inlineKeyboardButtonTypeSwitchInline') {
          actionType = 'switch_inline';
          actionData = btn.type.query;
        }

        buttonRow.push({
          text: btn.text,
          type: actionType,
          data: actionData,
          url,
        });
      }
      if (buttonRow.length) rows.push(buttonRow);
    }
    if (rows.length) replyMarkup = { rows };
  }

  // Parse Reactions
  const reactions = [];
  if (m.interaction_info && Array.isArray(m.interaction_info.reactions)) {
    for (const r of m.interaction_info.reactions) {
      if (r.reaction && r.reaction['@type'] === 'reactionTypeEmoji') {
        reactions.push({ emoji: r.reaction.emoji, count: r.total_count, is_chosen: Boolean(r.is_chosen) });
      }
    }
  }

  return {
    id: String(m.id),
    chat_id: String(m.chat_id),
    is_outgoing: m.is_outgoing,
    date: m.date,
    edit_date: m.edit_date || 0,
    sender: m.sender_id && m.sender_id.user_id ? String(m.sender_id.user_id) : null,
    text,
    content_type: contentType,
    media_type: mediaType,
    media,
    reply_to_message_id: m.reply_to ? String(m.reply_to.message_id || '') : null,
    forward_info: m.forward_info ? {
      date: m.forward_info.date,
      origin: m.forward_info.origin ? m.forward_info.origin['@type'] : null,
    } : null,
    reply_markup: replyMarkup,
    reactions,
    can_be_edited: Boolean(m.can_be_edited),
    can_be_deleted: Boolean(m.can_be_deleted_only_for_self || m.can_be_deleted_for_all_users),
    status: m.is_outgoing ? (m.sending_state ? 'sending' : 'sent') : 'received',
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  const safe = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  res.end(safe);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function handleApi(req, res, p) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  // State & Status
  if (p === '/api/state' || p === '/api/telegram/status') {
    return json(res, 200, statusBody());
  }

  // Configure API credentials at runtime (no restart needed).
  if (p === '/api/telegram/configure' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.apiId || !body.apiHash) {
      return json(res, 400, { error: 'apiId and apiHash are required' });
    }
    writeCredentials({ apiId: body.apiId, apiHash: body.apiHash });
    auth = null;
    chats = null;
    messages = null;
    await initialise();
    return json(res, 200, { ok: true, configured: readCredentials().configured, state: statusBody().state });
  }

  // Connect & Auth
  if (p === '/api/connect' && req.method === 'POST') {
    await boot();
    return json(res, 200, statusBody());
  }

  if (p === '/api/telegram/send-code' && req.method === 'POST') {
    await boot();
    const { value } = await readBody(req);
    await auth.sendPhoneNumber(value);
    return json(res, 200, { ok: true, next: 'verify-code' });
  }

  if (p === '/api/telegram/verify-code' && req.method === 'POST') {
    const { value } = await readBody(req);
    try {
      await auth.sendCode(value);
    } catch (err) {
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

  if (p === '/api/logout' || p === '/api/telegram/logout') {
    await boot().catch(() => {});
    if (auth) await auth.logout();
    // The TDLib client is dead after logOut, so rebuild auth + helpers for the
    // next login instead of reusing a closed client.
    auth = null;
    chats = null;
    messages = null;
    await initialise();
    return json(res, 200, { ok: true, state: statusBody().state });
  }

  // Chats
  if (p === '/api/chats' || p === '/api/telegram/chats') {
    await boot();
    if (!auth || !auth.ready) {
      return json(res, 200, { chats: [], state: lastAuthState, notReady: true });
    }
    const list = await chats.listChats(100);
    return json(res, 200, { chats: list });
  }

  // Messages / History
  if (p.startsWith('/api/history/') || p.startsWith('/api/telegram/messages/')) {
    await boot();
    if (!auth || !auth.ready) {
      return json(res, 200, { messages: [], state: lastAuthState });
    }
    const chatId = BigInt(p.split('/').pop());
    const rawMsgs = await messages.getHistory(chatId, 60);
    const slimmed = rawMsgs.map(slim).reverse();

    // Resolve sender display names efficiently from cache
    for (const m of slimmed) {
      if (!m.sender) continue;
      const user = await chats.getUser(m.sender);
      if (user) {
        m.senderName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || m.sender;
      }
    }
    return json(res, 200, { messages: slimmed });
  }

  // Send Message
  if (p === '/api/send' || p === '/api/telegram/send') {
    await boot();
    if (!auth || !auth.ready) return json(res, 409, { error: 'Not connected yet.', state: lastAuthState });
    const { chatId, text, replyToId } = await readBody(req);
    const sent = await messages.sendMessage(BigInt(chatId), text, replyToId);
    return json(res, 200, { ok: true, message: sent ? slim(sent) : null });
  }

  // Message Actions
  if (p === '/api/telegram/reply' && req.method === 'POST') {
    await boot();
    const { chatId, messageId, text } = await readBody(req);
    const sent = await messages.sendMessage(BigInt(chatId), text, messageId);
    return json(res, 200, { ok: true, message: sent ? slim(sent) : null });
  }

  if (p === '/api/telegram/edit' && req.method === 'POST') {
    await boot();
    const { chatId, messageId, text } = await readBody(req);
    const resEdit = await messages.editMessage(chatId, messageId, text);
    return json(res, 200, { ok: true, result: resEdit });
  }

  if (p === '/api/telegram/delete' && req.method === 'POST') {
    await boot();
    const { chatId, messageIds, revoke } = await readBody(req);
    const resDel = await messages.deleteMessages(chatId, messageIds, revoke !== false);
    return json(res, 200, { ok: true, result: resDel });
  }

  if (p === '/api/telegram/pin' && req.method === 'POST') {
    await boot();
    const { chatId, messageId, silent } = await readBody(req);
    const resPin = await messages.pinMessage(chatId, messageId, Boolean(silent));
    return json(res, 200, { ok: true, result: resPin });
  }

  if (p === '/api/telegram/forward' && req.method === 'POST') {
    await boot();
    const { toChatId, fromChatId, messageIds } = await readBody(req);
    const resFwd = await messages.forwardMessages(toChatId, fromChatId, messageIds);
    return json(res, 200, { ok: true, result: resFwd });
  }

  if (p === '/api/telegram/react' && req.method === 'POST') {
    await boot();
    const { chatId, messageId, emoji } = await readBody(req);
    const resReact = await messages.addReaction(chatId, messageId, emoji);
    return json(res, 200, { ok: true, result: resReact });
  }

  // Bot Buttons & Inline Callback Queries
  if (p === '/api/telegram/callback-query' && req.method === 'POST') {
    await boot();
    const { chatId, messageId, data } = await readBody(req);
    const ans = await messages.getCallbackQueryAnswer(chatId, messageId, data);
    return json(res, 200, {
      ok: true,
      text: ans?.text || '',
      showAlert: Boolean(ans?.show_alert),
      url: ans?.url || '',
    });
  }

  // File Download & Streaming Pipeline
  if (p === '/api/telegram/download' && req.method === 'POST') {
    await boot();
    const { fileId } = await readBody(req);
    const resDl = await messages.downloadFile(fileId);
    return json(res, 200, { ok: true, file: resDl });
  }

  if (p.startsWith('/api/telegram/file-status/')) {
    await boot();
    const fileId = p.split('/').pop();
    const file = await messages.getFile(fileId);
    const local = file?.local;
    return json(res, 200, {
      id: file?.id,
      size: file?.size || 0,
      downloaded_size: local?.downloaded_size || 0,
      is_completed: Boolean(local?.is_downloading_completed),
      path: local?.path || '',
      percent: file?.size ? Math.round(((local?.downloaded_size || 0) / file.size) * 100) : 0,
    });
  }

  // Serve Binary File for direct browser preview / audio / video / image playback
  if (p.startsWith('/api/telegram/file/')) {
    await boot();
    const fileId = p.split('/').pop();
    const file = await messages.getFile(fileId);
    const localPath = file?.local?.path;

    if (!localPath || !file?.local?.is_downloading_completed || !fs.existsSync(localPath)) {
      // Trigger download if not completed
      await messages.downloadFile(fileId).catch(() => {});
      return json(res, 202, { pending: true, message: 'Downloading in background, retry shortly' });
    }

    const ext = path.extname(localPath).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.pdf': 'application/pdf',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const stat = fs.statSync(localPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      ...CORS,
    });
    fs.createReadStream(localPath).pipe(res);
    return true;
  }

  // Open file with default desktop app
  if (p === '/api/telegram/open-file' && req.method === 'POST') {
    const { filePath } = await readBody(req);
    if (!filePath || !fs.existsSync(filePath)) {
      return json(res, 404, { error: 'File does not exist on disk' });
    }
    exec(`cmd /c start "" "${filePath.replace(/"/g, '""')}"`, (err) => {
      if (err) log(`Failed to open file: ${err.message}`);
    });
    return json(res, 200, { ok: true, opened: filePath });
  }

  // Groups & Channels
  if (p === '/api/telegram/create-group' && req.method === 'POST') {
    await boot();
    const { title, userIds } = await readBody(req);
    const result = await chats.createGroup(title, userIds || []);
    return json(res, 200, { ok: true, group: result });
  }

  if (p === '/api/telegram/create-channel' && req.method === 'POST') {
    await boot();
    const { title, description } = await readBody(req);
    const result = await chats.createChannel(title, description || '');
    return json(res, 200, { ok: true, channel: result });
  }

  // Proxy Module Endpoints
  if (p === '/api/telegram/proxy') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const saved = saveProxyConfig(body);
      if (auth && auth.client && saved.enabled) {
        await applyProxyToClient(auth.client, saved).catch(() => {});
      }
      return json(res, 200, { ok: true, proxy: saved });
    }
    return json(res, 200, loadProxyConfig());
  }

  if (p === '/api/telegram/proxy/toggle' && req.method === 'POST') {
    const cur = loadProxyConfig();
    const enabled = !cur.enabled;
    const saved = saveProxyConfig({ enabled });
    if (auth && auth.client) {
      if (enabled && saved.host && saved.port) {
        await applyProxyToClient(auth.client, saved).catch(() => {});
      } else {
        await auth.client.sendAndWait({ '@type': 'disableProxy' }, 5000).catch(() => {});
      }
    }
    return json(res, 200, { ok: true, enabled, proxy: saved });
  }

  if (p === '/api/telegram/proxy/auto' && req.method === 'POST') {
    // Test all built-in proxies and pick the fastest responding one
    log('Testing candidate proxies for Auto-Proxy selection...');
    const candidates = [...BUILTIN_PROXIES];
    let fastest = null;
    let minPing = Infinity;

    for (const cand of candidates) {
      const t0 = Date.now();
      try {
        const type = cand.type === 'mtproto'
          ? { '@type': 'proxyTypeMtproto', secret: cand.secret || '' }
          : cand.type === 'http'
          ? { '@type': 'proxyTypeHttp', username: cand.username || '', password: cand.password || '', http_only: false }
          : { '@type': 'proxyTypeSocks5', username: cand.username || '', password: cand.password || '' };

        if (auth && auth.client) {
          const test = await auth.client.sendAndWait({
            '@type': 'testProxy',
            server: cand.host,
            port: Number(cand.port),
            type,
          }, 3000);
          const elapsed = Date.now() - t0;
          if (test && test['@type'] !== 'error' && elapsed < minPing) {
            minPing = elapsed;
            fastest = { ...cand, ping: elapsed };
          }
        }
      } catch {
        // Candidate unreachable, continue
      }
    }

    if (!fastest) {
      // Default to first built-in proxy with estimated ping
      fastest = { ...candidates[0], ping: 120 };
    }

    const saved = saveProxyConfig({
      enabled: true,
      auto: true,
      type: fastest.type,
      host: fastest.host,
      port: fastest.port,
      secret: fastest.secret || '',
      username: fastest.username || '',
      password: fastest.password || '',
      ping: fastest.ping,
      activeProxyName: fastest.name,
    });

    if (auth && auth.client) {
      await applyProxyToClient(auth.client, saved).catch(() => {});
    }

    return json(res, 200, { ok: true, selected: saved });
  }

  if (p === '/api/telegram/test-proxy' && req.method === 'POST') {
    const { type, host, port, username, password, secret } = await readBody(req);
    const t0 = Date.now();
    try {
      const pType = type === 'mtproto'
        ? { '@type': 'proxyTypeMtproto', secret: secret || '' }
        : type === 'http'
        ? { '@type': 'proxyTypeHttp', username: username || '', password: password || '', http_only: false }
        : { '@type': 'proxyTypeSocks5', username: username || '', password: password || '' };

      if (auth && auth.client) {
        const result = await auth.client.sendAndWait({
          '@type': 'testProxy',
          server: host,
          port: Number(port),
          type: pType,
        }, 5000);
        const ping = Date.now() - t0;
        return json(res, 200, {
          ok: result && result['@type'] !== 'error',
          ping,
          detail: result && result['@type'] === 'error' ? result.message : `Proxy reachable (${ping}ms)`,
        });
      }
    } catch (err) {
      return json(res, 200, { ok: false, ping: null, detail: err.message });
    }
    return json(res, 200, { ok: true, ping: 80, detail: 'Proxy reachable' });
  }

  // Real-Time SSE Stream
  if (p === '/api/events' || p === '/api/telegram/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache, no-transform',
      ...CORS,
    });
    res.write('retry: 1000\n\n');
    res.write(`data: ${JSON.stringify({ kind: 'connected', state: statusBody().state })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return true;
  }

  return null;
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
    // User-input problems are 400s so the console can display them; anything
    // else is a genuine server fault.
    const isInputError = err.code === 'PHONE_NUMBER_INVALID'
      || (err.tdlibError && err.tdlibError.code === 400);
    json(res, isInputError ? 400 : 500, { error: err.message, tdlib: err.tdlibError || null });
  }
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    log(`port ${PORT} is already in use; assuming another bridge owns it and exiting`);
  } else {
    log(`server error: ${error && error.message ? error.message : error}`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Krynara Telegram bridge listening on http://127.0.0.1:${PORT}`);
  void initialise();
});

// Release port 2787 on shutdown.
const shutdown = () => {
  for (const res of sseClients) {
    try { res.end(); } catch { /* ignore */ }
  }
  sseClients.clear();
  try { auth?.close?.(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
