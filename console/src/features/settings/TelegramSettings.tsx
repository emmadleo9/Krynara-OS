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

export function TelegramSettings() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [step, setStep] = useState<'idle' | 'apikeys' | 'phone' | 'code' | 'password' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [proxy, setProxy] = useState(EMPTY_PROXY);
  const [proxyDraft, setProxyDraft] = useState(EMPTY_PROXY);
  const [proxyMsg, setProxyMsg] = useState('');
  // BUG 1 FIX: track whether the user has unsaved edits in the proxy form.
  // The 4-second status poll must NEVER overwrite fields the user is editing.
  const proxyDirtyRef = useRef(false);
  // Controlled inputs for phone / code / password (were uncontrolled DOM reads before).
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

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

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      const data = await res.json() as TgStatus;
      setStatus(data);
      // BUG 1 FIX: only seed the proxy form from the server ONCE (or when the
      // user has no in-progress edits). Previously this ran every 4s and reset
      // everything the user had typed back to the stored values.
      if (data.proxy && (!proxyLoadedRef.current || !proxyDirtyRef.current)) {
        proxyLoadedRef.current = true;
        const saved = data.proxy as typeof EMPTY_PROXY;
        setProxy(saved);
        setProxyDraft((current) => (proxyDirtyRef.current ? current : saved));
      }
      setStep(deriveStep(data));
      if (data.bridgeOnline === false) setMessage('Telegram bridge offline. Run: cd "D:\\Refrences and Codes\\tweb" ; node socialhub-server.js');
    } catch {
      setStatus(null);
      setStep('idle');
      setMessage('Gateway unreachable.');
    }
  }, [deriveStep]);

  const proxyLoadedRef = useRef(false);

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, [refresh]);

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
      setMessage(data.next ? `Accepted. Next step: ${data.next}.` : 'Accepted. Waiting for Telegram…');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const saveProxy = async () => {
    setProxyMsg('Saving…');
    try {
      // BUG 1 FIX: SAVE is the single commit point. After a successful save the
      // draft is marked clean so future polls may sync the server value in.
      proxyDirtyRef.current = false;
      const res = await fetch('/api/telegram/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProxyMsg(data.note || 'Saved.');
      setProxy(data.proxy ?? proxyDraft);
      setProxyDraft(data.proxy ?? proxyDraft);
    } catch (err) {
      setProxyMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const testProxy = async () => {
    setProxyMsg('Testing proxy…');
    try {
      const res = await fetch('/api/telegram/test-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyDraft),
      });
      const data = await res.json();
      setProxyMsg(data.ok ? `PROXY WORKS — ${data.detail}` : `PROXY FAILED — ${data.detail || data.error}`);
    } catch (err) {
      setProxyMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // BUG 4 FIX: remember the linked account so the Social Hub Telegram tab can
  // auto-load it. Written every time the poll sees an authorized session.
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
    setBusy('logout');
    try {
      await fetch('/api/telegram/logout', { method: 'POST' });
      setMessage('Logged out. Session cleared from tdlib-db.');
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

        {/* Step: API keys */}
        {step === 'apikeys' && (
          <p className="inline-status">
            No Telegram keys yet. Paste your Telegram API ID + API Hash in the MY ACCOUNTS grid above (two rows labelled
            “Telegram”), then click CONNECT on each — this panel switches to the phone step automatically.
          </p>
        )}

        {/* Step: phone */}
        {step === 'phone' && (
          <div className="settings-key-row">
            <input
              id="tg-phone"
              aria-label="Telegram phone number"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+92300XXXXXXX — your Telegram phone number"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('send-code', phone); }}
            />
            <button type="button" className="hud-button" onClick={() => void submit('send-code', phone)}>
              {busy === 'send-code' ? 'SENDING…' : 'SEND CODE'}
            </button>
          </div>
        )}

        {/* Step: code */}
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

        {/* Step: 2FA password */}
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

        {/* Step: connected */}
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
          <strong>PROXY (TELEGRAM BLOCKED IN PK)</strong>
          <span className={`status-dot${proxy.type && proxy.type !== 'none' ? '' : ' status-dot-offline'}`} />
          <small>{proxy.type === 'none' ? 'DIRECT (WILL FAIL IF DC BLOCKED)' : `${proxy.type.toUpperCase()} ${proxy.host}:${proxy.port}`}</small>
        </div>
        <small className="settings-scope-copy settings-key-scope">
          TDLib connects through this before touching Telegram DCs. MTProto proxies need server + secret only.
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
          <input placeholder="Host e.g. 45.12.34.56" value={proxyDraft.host} onChange={(e) => setProxyField({ host: e.target.value })} />
          <input placeholder="Port e.g. 1080" value={proxyDraft.port} onChange={(e) => setProxyField({ port: e.target.value })} />
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
        <small className="inline-status">After saving, restart the Telegram bridge (node socialhub-server.js) so TDLib reloads the route.</small>
      </div>
    </HudFrame>
  );

}
