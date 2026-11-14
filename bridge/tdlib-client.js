/**
 * TDLib JSON client over koffi FFI.
 *
 * `prebuilt-tdlib` ships the TDLib binary (tdjson.dll on Windows) and exposes
 * its path via getTdjson(). koffi loads it and binds the four tdjson entry
 * points:
 *
 *   int        td_create_client_id(void);
 *   void       td_send(int client_id, const char *request);
 *   const char*td_receive(double timeout);   // returns NULL when nothing arrived
 *   const char*td_execute(const char *request);
 *
 * Responses are correlated to callers with the `@extra` field, which TDLib
 * echoes back verbatim. Auth-state updates arrive unsolicited and are routed to
 * listeners instead.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let lib = null;
let tdCreateClientId = null;
let tdSend = null;
let tdReceive = null;
let tdExecute = null;

export function load() {
  if (lib) return;

  const { getTdjson, getTdlibInfo } = require('prebuilt-tdlib');
  const tdjsonPath = getTdjson();

  lib = koffi.load(tdjsonPath);
  tdCreateClientId = lib.func('int td_create_client_id(void)');
  tdSend = lib.func('void td_send(int client_id, str request)');
  tdReceive = lib.func('str td_receive(double timeout)');
  tdExecute = lib.func('str td_execute(str request)');

  // TDLib defaults to verbosity 5, which logs every td_receive poll
  // ("Begin to wait for updates...") and floods the console. Errors only.
  try {
    tdExecute(JSON.stringify({ '@type': 'setLogVerbosityLevel', new_verbosity_level: 1 }));
  } catch {
    /* older TDLib builds may reject it; harmless */
  }

  const info = getTdlibInfo();
  console.log(`[tdlib] loaded ${path.basename(tdjsonPath)} (TDLib ${info.version}, commit ${info.commit})`);
}

/** Blocking synchronous query (no client id needed). */
export function execute(request) {
  load();
  const raw = tdExecute(JSON.stringify(request));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class TdlibClient {
  constructor({ onUpdate } = {}) {
    load();
    this.clientId = tdCreateClientId();
    this.waiters = new Map();
    this.seq = 0;
    this.onUpdate = onUpdate || (() => {});
    this.receiving = false;
    this.lastError = null;

    // td_receive must be pumped continuously or requests never complete.
    this.timer = setInterval(() => this._pump(), 10);
    this.timer.unref?.();
  }

  _pump() {
    if (this.closed) return;
    // Drain everything that is already queued. A 0-second timeout returns
    // immediately instead of blocking the event loop.
    for (let i = 0; i < 200; i += 1) {
      const raw = tdReceive(0);
      if (!raw) break;
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    const extra = message['@extra'];
    if (typeof extra === 'string' && this.waiters.has(extra)) {
      const waiter = this.waiters.get(extra);
      this.waiters.delete(extra);
      clearTimeout(waiter.timer);
      if (message['@type'] === 'error') {
        const error = new Error(message.message || 'TDLib error');
        error.code = message.code;
        error.tdlibError = message;
        waiter.reject(error);
      } else {
        waiter.resolve(message);
      }
      return;
    }
    this.onUpdate(message);
  }

  /** Send a request and resolve with its response. */
  send(request) {
    tdSend(this.clientId, JSON.stringify(request));
  }

  sendAndWait(request, timeout = 10000) {
    const extra = `krynara_${(this.seq += 1)}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(extra);
        reject(new Error(`TDLib request timed out after ${timeout}ms (${request['@type']})`));
      }, timeout);
      this.waiters.set(extra, { resolve, reject, timer });
      this.send({ ...request, '@extra': extra });
    });
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('client closed'));
    }
    this.waiters.clear();
  }
}