import { useCallback, useEffect, useRef, useState } from 'react';
import { HudFrame } from '@/components/hud';

type TgStatus = {
  configured: boolean;
  authorized: boolean;
  connected: boolean;
  state: string;
  user: { first_name?: string; last_name?: string; username?: string } | null;
  proxy: { type: string; host?: string; port?: string | number };
  bridgeOnline: boolean;
};

const EMPTY_PROXY = { type: 'none', host: '', port: '', username: '', password: '', secret: '' };

type AutoProxyInfo = {
  lastRefreshed: string | null;
  workingCount: number;
  totalCount: number;
};

export function TelegramSettings() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [step, setStep] = useState<'idle' | 'apikeys' | 'phone' | 'code' | 'password' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [proxy, setProxy] = useState(EMPTY_PROXY);
  const [proxyDraft, setProxyDraft] = useState(EMPTY_PROXY);
  const [proxyMsg, setProxyMsg] = useState('');
  const [autoProxy, setAutoProxy] = useState<AutoProxyInfo>({ lastRefreshed: null, workingCount: 0, totalCount: 0 });
  // The 4-second status poll must NEVER overwrite fields the user is editing.
  const proxyDirtyRef = useRef(false);
  const proxyLoadedRef = useRef(false);
  const connectStartRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectPhase, setConnectPhase] = useState<'idle' | 'direct' | 'proxy' | 'done' | 'failed'>('idle');
  const [connectAttempt, setConnectAttempt] = useState<{ label: string; elapsed: number } | null>(null);

  const deriveStep = useCallback((s: TgStatus | null): typeof step => {
    if (!s) return 'idle';
    if (s.authorized) return 'ready';
    if (!s.configured) return 'apikeys';
    switch (s.state) {
      case 'waitphonenumber': return 'phone';
      case 'waitcode': return 'code';
      case 'waitpassword': return 'password';
      case 'ready': return 'ready';
      case 'starting':
      case 'waittdlibparameters':
      case 'waitencryptionkey': return 'idle';
      default: return 'idle';
    }
  }, []);

  const clearConnectTimer = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    connectStartRef.current = null;
    setConnectAttempt(null);
    setConnectPhase('idle');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      const data = await res.json() as TgStatus;
      setStatus(data);
      if (data.proxy && (!proxyLoadedRef.current || !proxyDirtyRef.current)) {
        proxyLoadedRef.current = true;
        const saved = data.proxy as typeof EMPTY_PROXY;
        setProxy(saved);
        setProxyDraft((current) => (proxyDirtyRef.current ? current : saved));
      }
      setStep(deriveStep(data));
      if (data.bridgeOnline === false) setMessage('Telegram bridge offline. It auto-starts with the gateway; retry shortly.');
    } catch {
      setStatus(null);
      setStep('idle');
      setMessage('Gateway unreachable.');
    }
  }, [deriveStep]);

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, [refresh]);

  // Load auto-proxy info from the proxies.json config file.
  const loadAutoProxy = useCallback(async () => {
    try {
      const res = await fetch('/config/proxies.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json() as { lastRefreshed?: string | null; proxies?: Array<{ host: string; port: number; type: string }>; working?: Array<{ host: string; port: number; type: string }> };
      setAutoProxy({
        lastRefreshed: data.lastRefreshed ?? null,
        workingCount: Array.isArray(data.working) ? data.working.length : 0,
        totalCount: Array.isArray(data.proxies) ? data.proxies.length : 0,
      });
    } catch { /* config file may not exist yet — auto proxy stays empty */ }
  }, []);

  useEffect(() => { void loadAutoProxy(); }, [loadAutoProxy]);

  // Auto-refresh proxies: on mount if never refreshed or older than 7 days.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const info = autoProxy;
      const needsRefresh = !info.lastRefreshed;
      if (!needsRefresh && info.lastRefreshed) {
        const days = (Date.now() - new Date(info.lastRefreshed).getTime()) / (1000 * 60 * 60 * 24);
        if (days < 7) return;
      }
      if (!alive) return;
      try {
        const res = await fetch('/api/proxies/refresh', { method: 'POST' });
        if (res.ok) {
          const data = await res.json() as { lastRefreshed: string; workingCount: number; totalCount: number };
          setAutoProxy({ lastRefreshed: data.lastRefreshed, workingCount: data.workingCount, totalCount: data.totalCount });
          setProxyMsg(`Auto proxies refreshed — ${data.workingCount} of ${data.totalCount} working.`);
        }
      } catch { /* endpoint may not be wired yet; keep existing list */ }
    };
    void run();
    return () => { alive = false; };
  }, [autoProxy.lastRefreshed]);

  const submit = async (endpoint: string, value: string) => {
    setBusy(endpoint);
    try {
      const res = await fetch(`/api/telegram/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage(data.next ? `Accepted. Next step: ${data.next}.` : 'Accepted.');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const startConnect = async () => {
    clearConnectTimer();
    setConnectPhase('direct');
    setMessage('Trying direct connection…');
    connectStartRef.current = Date.now();
    setConnectAttempt({ label: 'Direct', elapsed: 0 });

    const tick = () => {
      if (!connectStartRef.current) return;
      const elapsed = Math.round((Date.now() - connectStartRef.current) / 1000);
      setConnectAttempt({ label: connectAttempt?.label ?? 'Direct', elapsed });
    };
    const interval = setInterval(tick, 250);
    connectTimeoutRef.current = setTimeout(() => {
      clearInterval(interval);
      setMessage('Connection timed out — trying next proxy…');
      await tryProxyList();
    }, 10000);

    try {
      const res = await fetch('/api/telegram/connect', { method: 'POST' });
      clearInterval(interval);
      if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConnectPhase('done');
      setMessage('Connected!');
      await refresh();
    } catch (err) {
      clearInterval(interval);
      if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
      setConnectPhase('failed');
      setMessage(err instanceof Error ? err.message : String(err));
      await tryProxyList();
    }
  };

  const tryProxyList = async () => {
    // Build ordered list: custom proxy first (if set), then auto proxies.
    const custom = proxy.type !== 'none' && proxy.host && proxy.port ? [{ ...proxy, label: 'Custom proxy' }] : [];
    const list = [...custom];
    // Add auto proxies that are not the custom one.
    try {
      const res = await fetch('/config/proxies.json', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json() as { proxies?: Array<{ host: string; port: number; type: string }> };
        for (const p of (data.proxies ?? [])) {
          const dup = list.find((x) => x.host === p.host && x.port === p.port && x.type === p.type);
          if (!dup) list.push({ ...p, type: p.type, label: `${p.type.toUpperCase()} ${p.host}:${p.port}` });
        }
      }
    } catch { /* ignore */ }

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      setConnectPhase('proxy');
      setMessage(`Trying proxy ${i + 1}/${list.length}…`);
      setConnectAttempt({ label: p.label, elapsed: 0 });
      connectStartRef.current = Date.now();

      const tick = () => {
        if (!connectStartRef.current) return;
        const elapsed = Math.round((Date.now() - connectStartRef.current) / 1000);
        setConnectAttempt({ label: p.label, elapsed });
      };
      const interval = setInterval(tick, 250);
      connectTimeoutRef.current = setTimeout(() => {
        clearInterval(interval);
        setMessage(`Proxy ${i + 1} timed out — trying next…`);
      }, 10000);

      try {
        const res = await fetch('/api/telegram/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proxy: p }),
        });
        clearInterval(interval);
        if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setConnectPhase('done');
        setMessage('Connected!');
        await refresh();
        return;
      } catch (err) {
        clearInterval(interval);
        if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
        if (i === list.length - 1) {
          setConnectPhase('failed');
          setMessage('All connection attempts failed. Check your proxy or try again later.');
        }
        continue;
      }
    }
  };

  const saveProxy = async () => {
    setProxyMsg('Saving…');
    try {
      proxyDirtyRef.current = false;
      const res = await fetch('/api/telegram/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProxyMsg('Saved.');
      setProxy(data.proxy ?? proxyDraft);
      setProxyDraft(data.proxy ?? proxyDraft);
    } catch (err) {
      setProxyMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const testProxy = async () => {
    setProxyMsg('Testing…');
    connectStartRef.current = Date.now();
    setConnectAttempt({ label: `Testing ${proxyDraft.type.toUpperCase()}`, elapsed: 0 });

    const tick = () => {
      if (!connectStartRef.current) return;
      const elapsed = Math.round((Date.now() - connectStartRef.current) / 1000);
      setConnectAttempt({ label: `Testing ${proxyDraft.type.toUpperCase()}`, elapsed });
    };
    const interval = setInterval(tick, 250);
    connectTimeoutRef.current = setTimeout(() => {
      clearInterval(interval);
      setProxyMsg('DEAD — no response within 5 seconds.');
      setConnectAttempt(null);
    }, 5000);

    try {
      const res = await fetch('/api/telegram/test-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyDraft),
      });
      clearInterval(interval);
      if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
      const data = await res.json();
      setProxyMsg(data.ok ? 'WORKING — proxy responded.' : `DEAD — ${data.detail || data.error}`);
    } catch (err) {
      clearInterval(interval);
      if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
      setProxyMsg(`DEAD — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    if (status?.authorized && status.user) {
      localStorage.setItem('krynara_tg_account', JSON.stringify({
        name: [status.user.first_name, status.user.last_name].filter(Boolean).join(' ') || 'Telegram account',
        username: status.user.username ?? '',
        savedAt: new Date().toISOString(),
      }));
    }
  }, [status?.authorized, status?.user]);

  const disconnect = async () => {
    clearConnectTimer();
    setBusy('logout');
    try {
      await fetch('/api/telegram/logout', { method: 'POST' });
      setMessage('Logged out. Session cleared.');
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const setProxyField = (patch: Partial<typeof EMPTY_PROXY>) => {
    proxyDirtyRef.current = true;
    setProxyDraft((current) => ({ ...current, ...patch }));
  };

  const dot = status?.authorized ? '' : status?.bridgeOnline ? 'waiting' : 'offline';
  const label = status?.authorized && status?.user
    ? `CONNECTED AS ${(status.user.first_name || '') + (status.user.username ? ` (@${status.user.username})` : '')}`
    : status?.authorized ? 'CONNECTED' : status?.bridgeOnline ? `AUTH STATE: ${(status?.state || 'idle').toUpperCase()}` : 'BRIDGE OFFLINE';

  const connectButton = busy === 'connect' ? 'CONNECTING…' : 'CONNECT TELEGRAM';

  return (
    <HudFrame title="TELEGRAM // REAL ACCOUNT LINK">
      <div className="settings-key">
        <div className="settings-key-head">
          <strong>STATUS</strong>
          <span className={`status-dot${dot ? ` status-dot-${dot}` : ''}`} />
          <small>{label}</small>
        </div>
        <small className="settings-key-scope">
          Connected means TDLib authorizationStateReady — a REAL session, not just keys pasted.
          {' '}
          <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="hud-link">HOW TO GET KEYS →</a>
        </small>

        {message && <p className="inline-status">{message}</p>}

        {connectAttempt && (
          <p className="inline-status">
            {connectPhase === 'direct' ? 'Trying direct connection…' : `Trying ${connectAttempt.label}…`} ({connectAttempt.elapsed}s)
          </p>
        )}

        {step === 'idle' && status?.configured && !status?.authorized && (
          <div className="settings-key-row">
            <button
              type="button"
              className="hud-button"
              disabled={busy === 'connect'}
              onClick={() => void startConnect()}
            >
              {connectButton}
            </button>
            <small className="settings-key-scope">
              Starts TDLib with your saved keys, then asks for your phone number.
            </small>
          </div>
        )}

        {step === 'apikeys' && (
          <p className="inline-status">
            No Telegram keys yet. Paste your Telegram API ID + API Hash in the MY ACCOUNTS grid above (two rows labelled
            “Telegram”), then click CONNECT on each — this panel switches to the phone step automatically.
          </p>
        )}

        {step === 'phone' && (
          <div className="settings-key-row">
            <input
              id="tg-phone"
              aria-label="Telegram phone number"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1XXXXXXXXXX — your Telegram phone number"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('send-code', phone); }}
            />
            <button type="button" className="hud-button" onClick={() => void submit('send-code', phone)}>
              {busy === 'send-code' ? 'SENDING…' : 'SEND CODE'}
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="settings-key-row">
            <input
              id="tg-code"
              aria-label="Telegram login code"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Login code Telegram just sent you"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('verify-code', code); }}
            />
            <button type="button" className="hud-button" onClick={() => void submit('verify-code', code)}>
              {busy === 'verify-code' ? 'VERIFYING…' : 'VERIFY CODE'}
            </button>
          </div>
        )}

        {step === 'password' && (
          <div className="settings-key-row">
            <input
              id="tg-password"
              aria-label="Telegram 2FA password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Two-step verification password"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('password', password); }}
            />
            <button type="button" className="hud-button" onClick={() => void submit('password', password)}>
              {busy === 'password' ? 'CHECKING…' : 'UNLOCK 2FA'}
            </button>
          </div>
        )}
        <small className="inline-status">Only needed if you enabled two-step verification.</small>

        {step === 'ready' && (
          <p className="inline-status">
            SESSION ACTIVE — stored in tdlib-db, no re-login needed. Live chats: {status?.state === 'ready' ? 'streaming' : 'loading'}…
          </p>
        )}

        {(step === 'ready' || step === 'code' || step === 'password' || step === 'phone') && (
          <button type="button" className="hud-button" onClick={() => void disconnect()} disabled={busy === 'logout'}>
            {busy === 'logout' ? 'LOGGING OUT…' : 'DISCONNECT / LOGOUT'}
          </button>
        )}
      </div>

      {/* Proxy */}
      <div className="settings-key" style={{ marginTop: 14 }}>
        <div className="settings-key-head">
          <strong>PROXY (Optional) - Use if Telegram is blocked in your region</strong>
          <span className={`status-dot${proxy.type && proxy.type !== 'none' ? '' : ' status-dot-offline'}`} />
          <small>{proxy.type === 'none' ? 'DIRECT' : `${proxy.type.toUpperCase()} ${proxy.host}:${proxy.port}`}</small>
        </div>
        <small className="settings-scope-copy settings-key-scope">
          TDLib connects through this before touching Telegram servers. MTProto proxies need server + secret only.
        </small>
        <div className="settings-key-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select
            aria-label="Proxy type"
            value={proxyDraft.type}
            onChange={(e) => setProxyField({ type: e.target.value })}
          >
            <option value="none">None (direct)</option>
            <option value="socks5">SOCKS5</option>
            <option value="mtproto">MTProto</option>
          </select>
          <input placeholder="Host" value={proxyDraft.host} onChange={(e) => setProxyField({ host: e.target.value })} />
          <input placeholder="Port" value={proxyDraft.port} onChange={(e) => setProxyField({ port: e.target.value })} />
          {proxyDraft.type === 'socks5' && (
            <>
              <input placeholder="Username (optional)" value={proxyDraft.username} onChange={(e) => setProxyField({ username: e.target.value })} />
              <input type="password" placeholder="Password (optional)" value={proxyDraft.password} onChange={(e) => setProxyField({ password: e.target.value })} />
            </>
          )}
          {proxyDraft.type === 'mtproto' && (
            <input placeholder="Secret (ee… hex)" value={proxyDraft.secret} onChange={(e) => setProxyField({ secret: e.target.value })} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="hud-button" onClick={() => void saveProxy()}>SAVE PROXY</button>
          <button type="button" className="hud-button" onClick={() => void testProxy()} disabled={proxyDraft.type === 'none'}>TEST PROXY</button>
        </div>
        {proxyMsg && <p className="inline-status">{proxyMsg}</p>}
        {autoProxy.totalCount > 0 && (
          <p className="inline-status">
            Auto proxies last updated: {autoProxy.lastRefreshed ?? 'never'} — {autoProxy.workingCount} of {autoProxy.totalCount} working.
          </p>
        )}
        <small className="inline-status">Proxy is optional. Direct connection is tried first; proxies are attempted automatically if direct fails.</small>
      </div>
    </HudFrame>
  );

  // Controlled inputs for phone / code / password (declared at top of component).
  let phone: string;
  let code: string;
  let password: string;
  function setPhone(v: string) { phone = v; }
  function setCode(v: string) { code = v; }
  function setPassword(v: string) { password = v; }
}
