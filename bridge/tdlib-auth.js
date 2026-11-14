/**
 * Telegram authorization state machine.
 *
 * Drives TDLib from `closed` through the login flow and exposes exactly the
 * surface the HTTP layer needs: `state`, `user`, `proxy`, `ready`, `client`,
 * `sendPhoneNumber`, `sendCode`, `sendPassword`, `logout`.
 *
 * API credentials come from (in order):
 *   1. TELEGRAM_API_ID / TELEGRAM_API_HASH environment variables
 *   2. bridge/telegram.json  { "apiId": 123456, "apiHash": "..." }
 *
 * Session state is persisted by TDLib in bridge/data/tdlib, so a successful
 * login survives restarts and `authorized` becomes true without re-entering a
 * code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TdlibClient, execute } from './tdlib-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, 'data');
const DB_DIR = path.join(DATA_DIR, 'tdlib');
const FILES_DIR = path.join(DATA_DIR, 'files');
const CONFIG_FILE = path.join(__dirname, 'telegram.json');

const PROXY_FILE = path.join(DATA_DIR, 'proxy.json');

export function readCredentials() {
  const envId = Number(process.env.TELEGRAM_API_ID || 0);
  const envHash = String(process.env.TELEGRAM_API_HASH || '');

  let fileId = 0;
  let fileHash = '';
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    fileId = Number(parsed.apiId || parsed.api_id || 0);
    fileHash = String(parsed.apiHash || parsed.api_hash || '');
  } catch {
    /* no config file yet */
  }

  const apiId = envId || fileId;
  const apiHash = envHash || fileHash;
  return { apiId, apiHash, configured: Boolean(apiId > 0 && apiHash) };
}

export function writeCredentials({ apiId, apiHash }) {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiId: Number(apiId), apiHash: String(apiHash) }, null, 2));
}

export function loadProxyConfig() {
  const empty = { enabled: false, auto: false, type: 'none', host: '', port: '', username: '', password: '', secret: '', ping: null, activeProxyName: '' };
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(PROXY_FILE, 'utf8')) };
  } catch {
    return empty;
  }
}

export function saveProxyConfig(patch) {
  const next = { ...loadProxyConfig(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROXY_FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Builds the TDLib proxyType object for a config entry. */
export function proxyTypeFor(entry) {
  if (!entry) return null;
  if (entry.type === 'mtproto') return { '@type': 'proxyTypeMtproto', secret: entry.secret || '' };
  if (entry.type === 'http' || entry.type === 'https') {
    return { '@type': 'proxyTypeHttp', username: entry.username || '', password: entry.password || '', http_only: entry.type === 'https' };
  }
  return { '@type': 'proxyTypeSocks5', username: entry.username || '', password: entry.password || '' };
}

/**
 * Extracts the authorization-state type from either shape TDLib uses:
 *   - updates:      { '@type': 'updateAuthorizationState', authorization_state: { '@type': ... } }
 *   - direct reply: { '@type': 'authorizationStateWaitPhoneNumber' }   (no nesting)
 */
function stateTypeOf(message) {
  if (!message) return null;
  const direct = message['@type'];
  if (typeof direct === 'string' && direct.startsWith('authorizationState')) return direct;
  const nested = message.authorization_state?.['@type'];
  return typeof nested === 'string' ? nested : null;
}

export async function createAuth({ onEvent } = {}) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });

  const proxy = loadProxyConfig();

  const client = new TdlibClient({
    onUpdate: (message) => {
      handleUpdate(message);
      onEvent?.(message);
    },
  });

  let state = 'closed';
  let user = null;
  let chatsCount = 0;
  let booting = null;
  let lastError = null;

  function setState(next) {
    if (state === next) return;
    state = next;
    console.log(`[tdlib] auth state -> ${next}`);
  }

  async function handleUpdate(message) {
    switch (message['@type']) {
      case 'updateAuthorizationState': {
        const authState = message.authorization_state || message;
        switch (authState['@type']) {
          case 'authorizationStateWaitPhoneNumber':
            setState('waitphonenumber');
            break;
          case 'authorizationStateWaitCode':
            setState('waitcode');
            break;
          case 'authorizationStateWaitOtherDeviceConfirmation':
            setState('waitotherdeviceconfirmation');
            break;
          case 'authorizationStateWaitPassword':
            setState('waitpassword');
            break;
          case 'authorizationStateReady':
            setState('ready');
            await loadMe();
            break;
          case 'authorizationStateClosed':
            setState('closed');
            break;
          case 'authorizationStateLoggingOut':
            setState('loggingout');
            break;
          default:
            setState(authState['@type'] || 'unknown');
        }
        break;
      }
      case 'updateNewChat':
      case 'updateChatLastMessage':
        // Re-count occasionally so chats_count stays honest.
        void countChats();
        break;
      default:
        break;
    }
  }

  async function loadMe() {
    try {
      const me = await client.sendAndWait({ '@type': 'getMe' }, 10000);
      user = me && me['@type'] === 'user' ? me : null;
    } catch (error) {
      lastError = error.message;
    }
  }

  async function countChats() {
    try {
      const result = await client.sendAndWait({ '@type': 'getChats', chat_list: { '@type': 'chatListMain' }, limit: 200 }, 10000);
      if (result && Array.isArray(result.chat_ids)) chatsCount = result.chat_ids.length;
    } catch {
      /* not ready yet */
    }
  }

  async function boot() {
    if (state === 'ready') return auth;
    // Already initialised and waiting on the user (phone/code/password): there is
    // nothing to do, so avoid two extra round-trips per call.
    if (state !== 'closed' && state !== 'waittdlibparameters' && state !== 'loggingout') return auth;
    if (booting) return booting;

    const { apiId, apiHash, configured } = readCredentials();
    if (!configured) {
      const error = new Error('Telegram API credentials are not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH, or POST /api/telegram/configure.');
      error.code = 'NOT_CONFIGURED';
      throw error;
    }

    booting = (async () => {
      // getAuthorizationState is safe before parameters are set: it returns
      // authorizationStateWaitTdlibParameters, which we handle by initialising.
      const current = await client.sendAndWait({ '@type': 'getAuthorizationState' }, 10000).catch(() => null);
      const currentType = stateTypeOf(current);

      if (!currentType || currentType === 'authorizationStateWaitTdlibParameters') {
        console.log(`[tdlib] initialising TDLib (hash length ${String(apiHash).length}), db=${DB_DIR}`);
        try {
          const paramsResult = await client.sendAndWait({
            '@type': 'setTdlibParameters',
            use_test_dc: false,
            database_directory: DB_DIR,
            files_directory: FILES_DIR,
            database_encryption_key: '',
            use_storage_optimizer: true,
            api_id: apiId,
            api_hash: apiHash,
            system_language_code: 'en',
            device_model: 'Krynara-OS',
            application_version: '1.0.0',
          }, 30000);
          console.log(`[tdlib] setTdlibParameters -> ${JSON.stringify(paramsResult)}`);
        } catch (error) {
          // Do not mask this: a rejected api_id leaves TDLib stuck at
          // waitTdlibParameters, and reporting 'closed' hides the real cause.
          lastError = error.message;
          console.warn(`[tdlib] setTdlibParameters failed: ${error.message}`);
          setState('waittdlibparameters');
          return auth;
        }

        await client.sendAndWait({ '@type': 'checkDatabaseEncryptedKey', encryption_key: '' }, 15000).catch(() => null);
      }

      if (proxy.enabled && proxy.host && proxy.port) {
        const type = proxyTypeFor(proxy);
        if (type) {
          await client
            .sendAndWait({ '@type': 'enableProxy', enable: true, server: proxy.host, port: Number(proxy.port), type }, 15000)
            .catch(() => null);
        }
      }

      const authState = await client.sendAndWait({ '@type': 'getAuthorizationState' }, 15000).catch(() => null);
      const authType = stateTypeOf(authState);
      // Only change state when we actually got a definitive answer; otherwise
      // keep whatever the update stream reported.
      if (authType) setState(authType.replace('authorizationState', '').toLowerCase());

      return auth;
    })();

    try {
      return await booting;
    } finally {
      booting = null;
    }
  }

  const auth = {
    get client() {
      return client;
    },
    get state() {
      return state;
    },
    get user() {
      return user;
    },
    get proxy() {
      return proxy;
    },
    get ready() {
      return state === 'ready';
    },
    get chatsCount() {
      return chatsCount;
    },
    get configured() {
      return readCredentials().configured;
    },
    boot,

    async sendPhoneNumber(phone) {
      await boot();

      // TDLib only accepts a strict international number: optional leading '+'
      // followed by 7-15 digits. Anything else (spaces, dashes, brackets, a
      // missing country code) is rejected as PHONE_NUMBER_INVALID, so normalise
      // first and explain the problem instead of passing a raw error through.
      const raw = String(phone ?? '').trim();
      const compact = raw.replace(/[\s\-().]/g, '');
      const digits = compact.startsWith('+') ? compact.slice(1) : compact;

      if (!/^\d{7,15}$/.test(digits)) {
        const error = new Error(
          `"${raw}" is not a valid international phone number. Use the form +923001234567 ` +
          '(country code, then the number, with no spaces, dashes or brackets).',
        );
        error.code = 'PHONE_NUMBER_INVALID';
        throw error;
      }

      const normalized = `+${digits}`;
      console.log(`[tdlib] requesting code for ${normalized.slice(0, 4)}••• (len ${normalized.length})`);

      await client.sendAndWait({
        '@type': 'setAuthenticationPhoneNumber',
        phone_number: normalized,
        settings: {
          '@type': 'phoneNumberAuthenticationSettings',
          allow_flash_call: false,
          allow_missed_call: false,
          is_current_phone_number: false,
        },
      }, 20000);
      setState('waitcode');
      return true;
    },

    async sendCode(code) {
      await boot();
      const result = await client.sendAndWait({ '@type': 'checkAuthenticationCode', code: String(code) }, 20000);
      const type = result?.['@type'] === 'ok' ? state : result?.authorization_state?.['@type'];
      if (type && /password/i.test(type)) setState('waitpassword');
      return true;
    },

    async sendPassword(password) {
      await boot();
      await client.sendAndWait({ '@type': 'checkAuthenticationPassword', password: String(password) }, 20000);
      setState('ready');
      await loadMe();
      await countChats();
      return true;
    },

    async logout() {
      try {
        await client.sendAndWait({ '@type': 'logOut' }, 15000);
      } catch {
        /* already closed */
      }
      setState('closed');
      user = null;
      chatsCount = 0;
      // TDLib cannot be reused after logOut: the client is closed and further
      // requests (including setTdlibParameters) fail with "Request aborted".
      // Close it so the next boot builds a fresh client.
      try {
        client.close();
      } catch {
        /* ignore */
      }
    },

    async close() {
      client.close();
    },
  };

  // Surface a clean status body for /api/state.
  auth.statusBody = () => {
    const credentials = readCredentials();
    return {
      configured: credentials.configured,
      authorized: state === 'ready' && Boolean(user),
      connected: state === 'ready' && Boolean(user),
      state,
      user,
      proxy,
      chats_count: chatsCount,
    };
  };

  // Kick off the client so it can pick up an existing session immediately.
  await boot().catch((error) => {
    lastError = error.code === 'NOT_CONFIGURED' ? null : error.message;
    if (error.code !== 'NOT_CONFIGURED') console.warn(`[tdlib] initial boot failed: ${error.message}`);
  });

  // If a session already exists, refresh the user/counts in the background.
  if (state === 'ready') {
    void loadMe();
    void countChats();
  }

  auth.lastError = () => lastError;
  return auth;
}