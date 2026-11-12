// TDLib JSON client wrapper for Social Hub.
// Talks to tdjson.dll via a PowerShell bridge (tdlib-bridge.ps1)
// because Node.js on this machine has no FFI and no C++ compiler.
// Runs inside D:\Refrences and Codes\tweb, powered by prebuilt-tdlib (win32-x64).
//
// Protocol with the bridge (JSON lines over the bridge's stdout):
//   - Lines that are valid JSON are either responses to our requests
//     (matched via the "@extra" request id we attach) or unsolicited
//     updates. Responses resolve the pending promise; updates go into
//     an internal queue that receive() drains.
//   - Non-JSON lines ("OK" send-acks, "ERROR: ...") are ignored.
import { spawn } from 'node:child_process';
import path from 'path';

const BRIDGE_PATH = path.resolve(process.cwd(), 'src', 'telegram', 'tdlib-bridge.ps1');

export class TdClient {
  constructor() {
    this._proc = null;
    this._closed = false;
    this._buffer = '';
    this._started = false;
    this._nextExtra = 1;
    this._pending = new Map(); // extra id -> { resolve, timer }
    this._updateQueue = [];
    this._waitingForUpdate = []; // resolvers for receive()
  }

  _start() {
    if (this._started) return;
    this._started = true;
    this._proc = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      BRIDGE_PATH,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this._proc.stdout.on('data', (chunk) => {
      this._buffer += chunk.toString();
      this._flushLines();
    });
    this._proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.error(`[td bridge stderr] ${msg}`);
    });
    this._proc.on('close', (code) => {
      if (!this._closed) console.error(`[td client] bridge exited with code ${code}`);
      this._failAllPending(new Error('TDLib bridge closed'));
    });
    this._proc.on('error', (err) => {
      console.error('[td client] bridge spawn error:', err.message);
      this._failAllPending(err);
    });
  }

  _failAllPending(err) {
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this._pending.clear();
    for (const w of this._waitingForUpdate.splice(0)) w.reject(err);
  }

  _flushLines() {
    let idx;
    while ((idx = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (line === '') continue;
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // "OK" acks / "ERROR: ..." lines from the bridge — informational only.
      if (line.startsWith('ERROR:')) console.error(`[td bridge] ${line}`);
      return;
    }
    const extra = parsed['@extra'];
    if (extra !== undefined && this._pending.has(extra)) {
      const p = this._pending.get(extra);
      this._pending.delete(extra);
      clearTimeout(p.timer);
      p.resolve(parsed);
      return;
    }
    // Unsolicited TDLib update — queue it (or hand straight to a waiter).
    if (typeof extra === 'string' && extra === '@extra') {
      // echo of our request marker, ignore
      return;
    }
    this._dispatchUpdate(parsed);
  }

  _dispatchUpdate(update) {
    const waiter = this._waitingForUpdate.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(update);
      return;
    }
    this._updateQueue.push(update);
  }

  /**
   * Fire-and-forget send. Attaches a unique "@extra" id so the response
   * (ok / error / result object) is correlated back correctly.
   * If a caller wants the response, use sendAndWait instead.
   */
  send(requestJson) {
    if (this._closed) throw new Error('TDLib client is closed');
    this._start();
    let obj;
    try {
      obj = JSON.parse(requestJson);
    } catch {
      obj = { '@type': requestJson };
    }
    const extra = `req${this._nextExtra++}`;
    obj['@extra'] = extra;
    // Track responses even for fire-and-forget calls so errors are logged.
    const p = this._newPending();
    this._pending.set(extra, p);
    p.promise.then((res) => {
      if (res && res['@type'] === 'error') {
        console.error(`[tdlib] ${obj['@type']} failed:`, JSON.stringify(res));
      }
    }).catch(() => { });
    p.resolve = p.resolve; // assigned inside _newPending
    this._proc.stdin.write(`SEND\n${JSON.stringify(obj)}\n`);
    return extra;
  }

  /**
   * Send and await the correlated response (ok/error/result).
   * Rejects on TDLib "error" objects so callers see the FULL error.
   */
  sendAndWait(requestObj, timeoutMs = 20000) {
    if (this._closed) return Promise.reject(new Error('TDLib client is closed'));
    this._start();
    const extra = `req${this._nextExtra++}`;
    const obj = { ...requestObj, '@extra': extra };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(extra);
        reject(new Error(`TDLib request '${obj['@type']}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const p = this._newPending(timer, resolve, reject);
      this._pending.set(extra, p);
      this._proc.stdin.write(`SEND\n${JSON.stringify(obj)}\n`);
    }).then((res) => {
      if (res && res['@type'] === 'error') {
        const err = new Error(`TDLib ${res['@type']}: ${res.message} (code ${res.code})`);
        err.tdlibError = res;
        throw err;
      }
      return res;
    });
  }

  _newPending(timer, resolve, reject) {
    const p = {
      timer: timer || null,
      resolve: resolve || (() => { }),
      reject: reject || (() => { }),
      promise: null,
    };
    p.promise = new Promise((res, rej) => {
      p.resolve = res;
      p.reject = rej;
    });
    if (timer) {
      // resolve/reject already wired from sendAndWait
      p.resolve = resolve;
      p.reject = reject;
    }
    return p;
  }

  /**
   * Pull the next unsolicited TDLib update, waiting up to `timeout`
   * seconds. Returns null on quiet timeout.
   */
  async receive(timeout = 1.0) {
    if (this._closed) return null;
    if (this._updateQueue.length > 0) return this._updateQueue.shift();
    this._start();
    // Ask the bridge to poll TDLib for a short slice, repeatedly, until
    // the overall budget is spent. Bridge processing of queued SENDs
    // happens between slices.
    const deadline = Date.now() + Math.max(timeout, 0.1) * 1000;
    while (Date.now() < deadline && !this._closed) {
      if (this._updateQueue.length > 0) return this._updateQueue.shift();
      const slice = Math.min(0.25, (deadline - Date.now()) / 1000);
      if (slice <= 0) break;
      try {
        await this._bridgeReceive(slice);
      } catch (err) {
        console.error('[td client] receive error:', err.message);
        return null;
      }
      if (this._updateQueue.length > 0) return this._updateQueue.shift();
    }
    return null;
  }

  _bridgeReceive(timeoutSec) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waitingForUpdate = this._waitingForUpdate.filter((w) => w !== waiter);
        resolve(null); // quiet slice
      }, timeoutSec * 1000 + 500);
      const waiter = {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      };
      this._waitingForUpdate.push(waiter);
      try {
        this._proc.stdin.write(`RECEIVE\n${String(timeoutSec)}\n`);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this._proc.stdin.write('EXIT\n');
      this._proc.stdin.end();
    } catch { /* ignore */ }
    try {
      this._proc.kill();
    } catch { /* ignore */ }
    this._failAllPending(new Error('TDLib client closed'));
  }
}

export default TdClient;
