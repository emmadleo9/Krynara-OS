import { useCallback, useEffect, useState } from 'react';
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
      if (data.proxy) {
        setProxy(data.proxy as typeof EMPTY_PROXY);
        setProxyDraft(data.proxy as typeof EMPTY_PROXY);
      }
      setStep(deriveStep(data));
      if (data.bridgeOnline === false) setMessage('Telegram bridge offline. Run: cd "D:\\Refrences and Codes\\tweb" ; node socialhub-server.js');
    } catch {
      setStatus(null);
      setStep('idle');
      setMessage('Gateway unreachable.');
    }
  }, [deriveStep]);

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
      const res = await fetch('/api/telegram/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProxyMsg(data.note || 'Saved.');
      setProxy(data.proxy ?? proxyDraft);
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
              aria-label="Telegram phone number"
              autoComplete="off"
              placeholder="+92300XXXXXXX — your Telegram phone number"
              value={'' /* controlled below */}
              onChange={() => {}}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('send-code', (e.target as HTMLInputElement).value); }}
            />
            <button type="button" className="hud-button" onClick={(e) => void submit('send-code', (e.currentTarget.previousElementSibling as HTMLInputElement).value)}>
              {busy === 'send-code' ? 'SENDING…' : 'SEND CODE'}
            </button>
          </div>

        )}

        {/* Step: code */}
        {step === 'code' && (
          <div className="settings-key-row">
            <input
              aria-label="Telegram login code"
              autoComplete="one-time-code"
              placeholder="Login code Telegram just sent you"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('verify-code', (e.target as HTMLInputElement).value); }}
            />
            <button type="button" className="hud-button" onClick={(e) => void submit('verify-code', (e.currentTarget.previousElementSibling as HTMLInputElement).value)}>
              {busy === 'verify-code' ? 'VERIFYING…' : 'VERIFY CODE'}
            </button>
          </div>
        )}

        {/* Step: 2FA password */}
        {step === 'password' && (
          <div className="settings-key-row">
            <input
              aria-label="Telegram 2FA password"
              type="password"
              autoComplete="current-password"
              placeholder="Two-step verification password"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit('password', (e.target as HTMLInputElement).value); }}
            />
            <button type="button" className="hud-button" onClick={(e) => void submit('password', (e.currentTarget.firstElementChild as HTMLInputElement).value)}>
              {busy === 'password' ? 'CHECKING…' : 'UNLOCK 2FA'}
            </button>
            <small className="inline-status">Only needed if you enabled two-step verification.</small>
            {step === 'password' && null}
          </div>
        )}

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
            onChange={(e) => setProxyDraft({ ...proxyDraft, type: e.target.value })}
          >
            <option value="none">None (direct)</option>
            <option value="socks5">SOCKS5</option>
            <option value="mtproto">MTProto</option>
          </select>
          <input placeholder="Host e.g. 45.12.34.56" value={proxyDraft.host} onChange={(e) => setProxyDraft({ ...proxyDraft, host: e.target.value })} />
          <input placeholder="Port e.g. 1080" value={proxyDraft.port} onChange={(e) => setProxyDraft({ ...proxyDraft, port: e.target.value })} />
          {proxyDraft.type === 'socks5' && (
            <>
              <input placeholder="Username (optional)" value={proxyDraft.username} onChange={(e) => setProxyDraft({ ...proxyDraft, username: e.target.value })} />
              <input type="password" placeholder="Password (optional)" value={proxyDraft.password} onChange={(e) => setProxyDraft({ ...proxyDraft, password: e.target.value })} />
            </>
          )}
          {proxyDraft.type === 'mtproto' && (
            <input placeholder="Secret (ee… hex)" value={proxyDraft.secret} onChange={(e) => mtprotoSecret(e.target.value)} />
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

  function mtprotoSecret(v: string) { setProxyDraft((cur) => ({ ...cur, secret: v })); }
}
