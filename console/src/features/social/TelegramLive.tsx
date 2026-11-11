import { useCallback, useEffect, useRef, useState } from 'react';
import { HudFrame } from '@/components/hud';

/**
 * REAL Telegram view — backed by the TDLib bridge (gateway /api/telegram/*).
 * No mock data: if the bridge is offline or the session is not authorized it
 * shows the real error returned by the backend.
 */

type TgChat = { id: string; title: string; unread: number; lastMessage?: string | null };
type TgMessage = { id: string; outgoing: boolean; text: string; at: string; sender?: string };
type TgStatus = {
  configured: boolean;
  authorized: boolean;
  connected: boolean;
  state: string;
  user: { first_name?: string; last_name?: string; username?: string } | null;
  bridgeOnline: boolean;
  error?: string;
};

export function readSavedAccount(): { name: string; username: string; savedAt: string } | null {
  try {
    const raw = localStorage.getItem('krynara_tg_account');
    return raw ? JSON.parse(raw) as { name: string; username: string; savedAt: string } : null;
  } catch {
    return null;
  }
}

export function TelegramLive() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const [chats, setChats] = useState<TgChat[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<TgMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/chats');
      const body = await res.json() as { chats?: TgChat[]; error?: string; state?: string };
      if (!res.ok) {
        setChats([]);
        setBridgeError(body.error || `Telegram backend returned HTTP ${res.status}${body.state ? ` (auth state: ${body.state})` : ''}`);
        return;
      }
      setBridgeError('');
      setChats(body.chats ?? []);
      setActiveId((current) => current || body.chats?.[0]?.id || '');
    } catch (err) {
      setChats([]);
      setBridgeError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/telegram/messages/${encodeURIComponent(chatId)}`);
      const body = await res.json() as { messages?: TgMessage[]; error?: string };
      if (!res.ok) {
        setMessages([]);
        setBridgeError(body.error || `HTTP ${res.status}`);
        return;
      }
      setBridgeError('');
      setMessages(body.messages ?? []);
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        const data = await res.json() as TgStatus;
        if (alive) {
          setStatus(data);
          setBridgeError(res.ok ? '' : `Telegram bridge: ${data.error || `HTTP ${res.status}`}`);
        }
      } catch (err) {
        if (alive) {
          setStatus(null);
          setBridgeError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (status?.authorized) void loadChats();
  }, [status?.authorized, loadChats]);

  useEffect(() => {
    if (!status?.authorized) return;
    void loadMessages(activeId);
    const timer = activeId ? window.setInterval(() => void loadMessages(activeId), 4000) : undefined;
    return () => { if (timer) window.clearInterval(timer); };
  }, [activeId, status?.authorized, loadMessages]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setSendError('');
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeId, text }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDraft('');
      await loadMessages(activeId);
      await loadChats();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const account = readSavedAccount();

  // No account linked in Settings → clear instruction, exactly as specified.
  if (!status?.authorized) {
    return (
      <div className="social-workspace">
        <HudFrame title="TELEGRAM // REAL ACCOUNT LINK" className="social-settings">
          <div className="integration-status">
            <span className="status-dot status-dot-offline" />
            {bridgeError ? 'BRIDGE ERROR' : 'NOT CONNECTED'}
          </div>
          {!account && (
            <p className="credential-notice">
              No account selected — go to <strong>SETTINGS → MY ACCOUNTS</strong>, paste your Telegram API ID +
              API Hash, complete phone/code login, then return here.
            </p>
          )}
          {account && (
            <p className="credential-notice">
              Saved account: <strong>{account.name}</strong>{account.username ? ` (@${account.username})` : ''}.
              Complete the login in SETTINGS → Telegram if the session expired.
            </p>
          )}
          {status && !status.bridgeOnline && (
            <p className="credential-notice">
              Bridge offline — it auto-starts with the gateway; retry in ~10 s or run:{' '}
              <code>cd "D:\Refrences and Codes\tweb" ; node socialhub-server.js</code>
            </p>
          )}
          {bridgeError && <p className="connection-message" role="alert">{bridgeError}</p>}
        </HudFrame>
      </div>
    );
  }

  return (
    <div className="social-workspace">
      <HudFrame title="TELEGRAM // CONVERSATIONS" className="social-chat-list">
        {chats.map((chat) => (
          <button
            type="button"
            className={chat.id === activeId ? 'chat-list-item selected' : 'chat-list-item'}
            key={chat.id}
            onClick={() => { setActiveId(chat.id); setMessages([]); }}
          >
            <span className="chat-list-title">{chat.title}{chat.unread > 0 && <span className="unread-dot" />}</span>
            <span className="chat-list-preview">{chat.lastMessage || ' '}</span>
          </button>
        ))}
        {chats.length === 0 && <p className="social-local-note">{bridgeError || 'LOADING CHATS…'}</p>}
      </HudFrame>

      <HudFrame title={chats.find((c) => c.id === activeId)?.title ?? 'TELEGRAM'} className="social-chat">
        <div className="chat-messages" aria-live="polite" ref={scrollerRef}>
          {messages.map((message) => (
            <div key={message.id} className={message.outgoing ? 'chat-bubble outgoing' : 'chat-bubble'}>
              <div>{message.text}</div>
              <time>{message.sender ? `${message.sender} · ` : ''}{message.at}</time>
            </div>
          ))}
          {activeId && messages.length === 0 && <p className="social-local-note">NO MESSAGES YET / LOADING…</p>}
        </div>
        <form
          className="chat-compose"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          <input
            aria-label="Telegram message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message… (sent via the REAL Telegram session)"
          />
          <button className="hud-button" type="submit" disabled={sending}>{sending ? 'SENDING…' : 'SEND'}</button>
        </form>
        {sendError && <p className="connection-message" role="alert">{sendError}</p>}
      </HudFrame>

      <HudFrame title="TELEGRAM // CONNECTION" className="social-settings">
        <div className="integration-status">
          <span className="status-dot" />
          CONNECTED AS {[status.user?.first_name, status.user?.last_name].filter(Boolean).join(' ')}
          {status.user?.username ? ` (@${status.user.username})` : ''}
        </div>
        <p className="credential-notice">
          Real TDLib session. Messages are sent with your actual Telegram account — no demo data.
        </p>
      </HudFrame>
    </div>
  );
}
