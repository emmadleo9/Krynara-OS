import { useCallback, useEffect, useRef, useState } from 'react';
import { HudFrame } from '@/components/hud';

/**
 * REAL Telegram view — backed by the TDLib bridge (gateway /api/telegram/*).
 * No mock data: if the bridge is offline or the session is not authorized it
 * shows the real error returned by the backend.
 */

type TgChat = {
  id: string;
  title: string;
  type?: string;
  unread_count?: number;
  last_message?: { text?: string; date?: number; outgoing?: boolean } | null;
};
type TgMessage = {
  id: string;
  outgoing: boolean;
  text: string;
  date: number;
  sender?: string;
  senderName?: string;
  pending?: boolean;
};
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

  const [chatsLoading, setChatsLoading] = useState(false);

  const mapChat = (c: TgChat): TgChat => ({
    id: String(c.id),
    title: c.title || `Chat ${c.id}`,
    type: c.type,
    unread_count: c.unread_count || 0,
    last_message: c.last_message ?? null,
  });

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const res = await fetch('/api/telegram/chats');
      const body = await res.json() as { chats?: TgChat[]; error?: string; state?: string };
      console.log('[TG] getChats response:', body);
      if (!res.ok) {
        setChats([]);
        setBridgeError(body.error || `Telegram backend returned HTTP ${res.status}${body.state ? ` (auth state: ${body.state})` : ''}`);
        return;
      }
      setBridgeError('');
      const mapped = (body.chats ?? []).map(mapChat);
      console.log(`[TG] ${mapped.length} chats loaded`);
      setChats(mapped);
      setActiveId((current) => current || mapped[0]?.id || '');
    } catch (err) {
      console.error('[TG] getChats failed:', err);
      setChats([]);
      setBridgeError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatsLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/telegram/messages/${encodeURIComponent(chatId)}`);
      const body = await res.json() as { messages?: TgMessage[]; error?: string };
      console.log(`[TG] getChatHistory(${chatId}):`, body.error || `${body.messages?.length ?? 0} messages`);
      if (!res.ok) {
        setMessages([]);
        setBridgeError(body.error || `HTTP ${res.status}`);
        return;
      }
      setBridgeError('');
      setMessages((body.messages ?? []).map((m) => ({ ...m, date: m.date || 0 })));
    } catch (err) {
      console.error('[TG] getChatHistory failed:', err);
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
    if (!status?.authorized) return;
    void loadChats();
    // Live list updates: poll while authorized — updateChatLastMessage /
    // updateNewMessage land in the bridge cache and show up here within 5 s.
    const timer = window.setInterval(() => void loadChats(), 5000);
    return () => window.clearInterval(timer);
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
    // Show the message immediately while the real sendMessage is in flight.
    const tempId = `pending-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, outgoing: true, text, date: Math.floor(Date.now() / 1000), pending: true }]);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeId, text }),
      });
      const body = await res.json() as { error?: string; message?: TgMessage };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDraft('');
      // Optimistically show the sent message immediately, then reconcile
      // with the real TDLib history (which carries the canonical id/status).
      setMessages((prev) => [
        ...prev.filter((m) => !m.pending),
        ...(body.message ? [{ ...body.message, pending: false }] : []),
      ]);
      await loadMessages(activeId);
      await loadChats();
    } catch (err) {
      // Drop the optimistic bubble only when the send really failed.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
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
            <span className="chat-list-title">
              {chat.title}
              {(chat.unread_count ?? 0) > 0 && <span className="unread-badge">{chat.unread_count}</span>}
            </span>
            <span className="chat-list-preview">
              {chat.last_message?.date ? new Date(chat.last_message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}
              {chat.last_message?.text || ' '}
            </span>
          </button>
        ))}
        {chatsLoading && <p className="social-local-note">Loading your chats…</p>}
        {!chatsLoading && chats.length === 0 && !bridgeError && (
          <p className="social-local-note">No chats found. Check getChats response in console.</p>
        )}
        {!chatsLoading && chats.length === 0 && bridgeError && <p className="social-local-note">{bridgeError}</p>}
      </HudFrame>

      <HudFrame title={chats.find((c) => c.id === activeId)?.title ?? 'TELEGRAM'} className="social-chat">
        <div className="chat-messages" aria-live="polite" ref={scrollerRef}>
          {messages.map((message) => (
            <div key={message.id} className={message.outgoing ? 'chat-bubble outgoing' : 'chat-bubble'}>
              {!message.outgoing && message.senderName && <div className="chat-sender">{message.senderName}</div>}
              <div>{message.text}</div>
              <time>
                {message.date ? new Date(message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                {message.outgoing ? (message.pending ? ' · sending…' : ' · sent ✓') : ''}
              </time>
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
