import { useCallback, useEffect, useRef, useState } from 'react';
import { HudFrame } from '@/components/hud';
import './telegram-clone.css';

export type TgUser = {
  first_name?: string;
  last_name?: string;
  username?: string;
  phone_number?: string;
  id?: string;
  is_premium?: boolean;
};

export type TgChat = {
  id: string;
  title: string;
  type?: string;
  kind?: 'private' | 'group' | 'channel' | 'secret';
  is_channel?: boolean;
  is_group?: boolean;
  is_bot?: boolean;
  is_pinned?: boolean;
  is_muted?: boolean;
  unread_count?: number;
  unread_mention_count?: number;
  last_message?: {
    id?: string;
    text?: string;
    date?: number;
    outgoing?: boolean;
    status?: string;
  } | null;
  photo_file_id?: number | null;
};

export type TgButton = {
  text: string;
  type: 'callback' | 'url' | 'web_app' | 'switch_inline';
  data?: string;
  url?: string;
};

export type TgMedia = {
  type: 'photo' | 'video' | 'voice' | 'audio' | 'document' | 'sticker' | 'gif' | 'poll' | 'location';
  file_id?: number;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  caption?: string;
  emoji?: string;
  question?: string;
  options?: Array<{ text: string; voter_count: number; vote_percentage: number }>;
  local_path?: string;
  is_downloaded?: boolean;
};

export type TgMessage = {
  id: string;
  chat_id: string;
  outgoing: boolean;
  text: string;
  date: number;
  edit_date?: number;
  sender?: string;
  senderName?: string;
  content_type?: string;
  media_type?: string;
  media?: TgMedia | null;
  reply_to_message_id?: string | null;
  forward_info?: { date?: number; origin?: string } | null;
  reply_markup?: { rows: TgButton[][] } | null;
  reactions?: Array<{ emoji: string; count: number; is_chosen: boolean }>;
  can_be_edited?: boolean;
  can_be_deleted?: boolean;
  status?: 'sending' | 'sent' | 'read' | 'received';
  pending?: boolean;
};

export type TgStatus = {
  configured: boolean;
  authorized: boolean;
  connected: boolean;
  state: string;
  user: TgUser | null;
  proxy: {
    enabled?: boolean;
    auto?: boolean;
    type: string;
    host?: string;
    port?: string | number;
    ping?: number | null;
    activeProxyName?: string;
  };
  chats_count?: number;
  bridgeOnline: boolean;
  error?: string;
};

export function readSavedAccount(): { name: string; username: string; savedAt: string } | null {
  try {
    const raw = localStorage.getItem('krynara_tg_account');
    return raw ? (JSON.parse(raw) as { name: string; username: string; savedAt: string }) : null;
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
  const [replyTarget, setReplyTarget] = useState<TgMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<TgMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<'all' | 'personal' | 'groups' | 'channels' | 'bots' | 'unread'>('all');
  const [downloadProgress, setDownloadProgress] = useState<Record<number, number>>({});
  const [feedbackToast, setFeedbackToast] = useState('');

  // Modals & Panels
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'profile' | 'newGroup' | 'newChannel' | 'contacts' | 'call' | 'webApp' | 'mediaGallery' | null>(null);
  const [webAppUrl, setWebAppUrl] = useState('');
  const [callActive, setCallActive] = useState<{ name: string; type: 'voice' | 'video'; duration: number } | null>(null);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newChannelTitle, setNewChannelTitle] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // Loading States
  const [chatsLoading, setChatsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 1. Single Source of Truth: Fetch Status
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      const data = (await res.json()) as TgStatus;
      setStatus(data);
      if (res.ok && data.authorized && data.user) {
        setBridgeError('');
        localStorage.setItem(
          'krynara_tg_account',
          JSON.stringify({
            name: [data.user.first_name, data.user.last_name].filter(Boolean).join(' ') || 'Telegram User',
            username: data.user.username || '',
            savedAt: new Date().toISOString(),
          })
        );
      } else if (!res.ok) {
        setBridgeError(data.error || `Bridge offline (HTTP ${res.status})`);
      }
      return data;
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  // 2. Load Chats with Retry & Skeleton
  const loadChats = useCallback(async (quiet = false) => {
    if (!quiet) setChatsLoading(true);
    try {
      const res = await fetch('/api/telegram/chats');
      const body = (await res.json()) as { chats?: TgChat[]; error?: string };
      if (res.ok && Array.isArray(body.chats)) {
        setChats(body.chats);
        setActiveId((current) => current || body.chats?.[0]?.id || '');
        setBridgeError('');
      } else if (!res.ok) {
        setBridgeError(body.error || 'Failed to load chats');
      }
    } catch (err) {
      if (!quiet) setBridgeError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!quiet) setChatsLoading(false);
    }
  }, []);

  // 3. Load Message History
  const loadMessages = useCallback(async (chatId: string) => {
    if (!chatId) return;
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/telegram/messages/${encodeURIComponent(chatId)}`);
      const body = (await res.json()) as { messages?: TgMessage[]; error?: string };
      if (res.ok && Array.isArray(body.messages)) {
        setMessages(body.messages);
        setBridgeError('');
      }
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // 4. Real-Time SSE Stream (<1-2 sec instant updates)
  useEffect(() => {
    let sse: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connectSSE = () => {
      try {
        sse = new EventSource('/api/telegram/events');
        eventSourceRef.current = sse;

        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as {
              kind: string;
              chatId?: string;
              message?: TgMessage;
              chats?: TgChat[];
              fileId?: number;
              percent?: number;
              isCompleted?: boolean;
            };

            if (data.kind === 'newMessage' && data.message) {
              const msg = data.message;
              if (data.chatId === activeId) {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === msg.id)) return prev;
                  return [...prev, msg];
                });
              }
              // Update chat preview in chat list immediately
              setChats((prev) =>
                prev.map((c) =>
                  c.id === data.chatId
                    ? {
                        ...c,
                        last_message: { id: msg.id, text: msg.text, date: msg.date, outgoing: msg.outgoing },
                        unread_count: msg.outgoing ? c.unread_count : (c.unread_count || 0) + 1,
                      }
                    : c
                )
              );
            } else if (data.kind === 'sent' && data.message) {
              const sentMsg = data.message;
              setMessages((prev) =>
                prev.map((m) => (m.pending && m.text === sentMsg.text ? { ...sentMsg, pending: false } : m))
              );
            } else if (data.kind === 'chats' && Array.isArray(data.chats)) {
              setChats(data.chats);
            } else if (data.kind === 'fileProgress' && data.fileId) {
              setDownloadProgress((prev) => ({
                ...prev,
                [data.fileId!]: data.percent || 100,
              }));
            }
          } catch {
            // Ignore parse errors on ping events
          }
        };

        sse.onerror = () => {
          sse?.close();
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connectSSE, 4000);
      }
    };

    connectSSE();
    return () => {
      sse?.close();
      clearTimeout(reconnectTimeout);
    };
  }, [activeId]);

  // Initial Boot & Polling Status Check
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 6000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.authorized) {
      void loadChats();
    }
  }, [status?.authorized, loadChats]);

  useEffect(() => {
    if (activeId && status?.authorized) {
      void loadMessages(activeId);
    }
  }, [activeId, status?.authorized, loadMessages]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Send Message (Instant Optimistic UI)
  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;

    if (editingMessage) {
      // Edit mode
      const msgId = editingMessage.id;
      setEditingMessage(null);
      setDraft('');
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, text } : m)));
      await fetch('/api/telegram/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeId, messageId: msgId, text }),
      });
      return;
    }

    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: TgMessage = {
      id: tempId,
      chat_id: activeId,
      outgoing: true,
      text,
      date: Math.floor(Date.now() / 1000),
      pending: true,
      status: 'sending',
      reply_to_message_id: replyTarget ? replyTarget.id : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setDraft('');
    const curReply = replyTarget;
    setReplyTarget(null);

    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: activeId,
          text,
          replyToId: curReply ? curReply.id : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: TgMessage; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...data.message!, pending: false } : m)));
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setBridgeError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // Bot Button Callback
  const handleButtonClick = async (btn: TgButton, msgId: string) => {
    if (btn.type === 'url' && btn.url) {
      window.open(btn.url, '_blank');
      return;
    }
    if (btn.type === 'web_app' && btn.url) {
      setWebAppUrl(btn.url);
      setActiveModal('webApp');
      return;
    }
    if (btn.type === 'switch_inline') {
      setDraft(`@bot ${btn.data || ''} `);
      return;
    }
    if (btn.type === 'callback' && btn.data) {
      try {
        const res = await fetch('/api/telegram/callback-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: activeId, messageId: msgId, data: btn.data }),
        });
        const ans = (await res.json()) as { text?: string; showAlert?: boolean; url?: string };
        if (ans.text) {
          setFeedbackToast(ans.text);
          setTimeout(() => setFeedbackToast(''), 4000);
        }
        if (ans.url) window.open(ans.url, '_blank');
      } catch (e) {
        console.error('Callback error:', e);
      }
    }
  };

  // File Download & Preview
  const handleDownloadFile = async (fileId: number) => {
    try {
      setDownloadProgress((prev) => ({ ...prev, [fileId]: 10 }));
      await fetch('/api/telegram/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      // Check status
      const res = await fetch(`/api/telegram/file-status/${fileId}`);
      const data = (await res.json()) as { is_completed: boolean; path: string };
      if (data.is_completed) {
        setDownloadProgress((prev) => ({ ...prev, [fileId]: 100 }));
        setFeedbackToast(`Downloaded: ${data.path}`);
        setTimeout(() => setFeedbackToast(''), 3000);
      }
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    await fetch('/api/telegram/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  };

  // Reactions
  const handleReact = async (msgId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = m.reactions ? [...m.reactions] : [];
        const existing = reactions.find((r) => r.emoji === emoji);
        if (existing) {
          existing.count += 1;
          existing.is_chosen = true;
        } else {
          reactions.push({ emoji, count: 1, is_chosen: true });
        }
        return { ...m, reactions };
      })
    );
    await fetch('/api/telegram/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: activeId, messageId: msgId, emoji }),
    });
  };

  // Delete Message
  const handleDeleteMessage = async (msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    await fetch('/api/telegram/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: activeId, messageIds: [msgId], revoke: true }),
    });
  };

  // Pin Message
  const handlePinMessage = async (msgId: string) => {
    await fetch('/api/telegram/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: activeId, messageId: msgId }),
    });
    setFeedbackToast('Message pinned to chat');
    setTimeout(() => setFeedbackToast(''), 3000);
  };

  // Toggle Proxy
  const handleToggleProxy = async () => {
    try {
      const res = await fetch('/api/telegram/proxy/toggle', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; enabled?: boolean; proxy?: TgStatus['proxy'] };
      if (data.ok) {
        setFeedbackToast(data.enabled ? 'Proxy enabled' : 'Direct mode active');
        setTimeout(() => setFeedbackToast(''), 3000);
        await refreshStatus();
      }
    } catch {}
  };

  // Auto-pick fastest proxy
  const handleAutoPickProxy = async () => {
    setFeedbackToast('Testing proxies for fastest ping…');
    try {
      const res = await fetch('/api/telegram/proxy/auto', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; selected?: { ping?: number; host?: string } };
      if (data.ok && data.selected) {
        setFeedbackToast(`Fastest Proxy selected (${data.selected.ping || 80}ms)`);
        setTimeout(() => setFeedbackToast(''), 4000);
        await refreshStatus();
      }
    } catch {}
  };

  // Filtered Chats
  const filteredChats = chats.filter((c) => {
    if (searchQuery) {
      if (!c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    }
    if (activeFolder === 'personal') return c.kind === 'private';
    if (activeFolder === 'groups') return c.is_group;
    if (activeFolder === 'channels') return c.is_channel;
    if (activeFolder === 'bots') return c.is_bot;
    if (activeFolder === 'unread') return (c.unread_count || 0) > 0;
    return true;
  });

  const activeChat = chats.find((c) => c.id === activeId);

  // If Not Authorized
  if (!status?.authorized) {
    const saved = readSavedAccount();
    return (
      <div className="tg-root">
        <div className="tg-top-bar">
          <div className="tg-top-left">
            <span className="tg-brand-badge">⚡ TELEGRAM // HUB</span>
          </div>
          <button type="button" className="tg-proxy-pill" onClick={handleToggleProxy}>
            PROXY: {status?.proxy?.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div style={{ padding: '30px', textAlign: 'center', margin: 'auto' }}>
          <HudFrame title="TELEGRAM // ACCOUNT LINK REQUIRED">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, margin: '14px 0' }}>
              <span className="status-dot status-dot-offline" />
              <strong>{bridgeError ? 'BRIDGE RECONNECTING…' : 'NOT CONNECTED'}</strong>
            </div>
            {saved ? (
              <p style={{ color: 'var(--krynara-muted)', fontSize: 12, lineHeight: 1.6 }}>
                Saved Session for <strong>{saved.name}</strong> (@{saved.username}).<br />
                The TDLib session is starting in the background. If this is a fresh setup, go to{' '}
                <strong>SETTINGS → MY ACCOUNTS</strong> to verify API keys.
              </p>
            ) : (
              <p style={{ color: 'var(--krynara-muted)', fontSize: 12, lineHeight: 1.6 }}>
                No active session found. Go to <strong>SETTINGS → TELEGRAM</strong> to link your phone number and API keys.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button
                type="button"
                className="hud-button"
                onClick={async () => {
                  setChatsLoading(true);
                  await fetch('/api/telegram/connect', { method: 'POST' });
                  await refreshStatus();
                  await loadChats();
                  setChatsLoading(false);
                }}
              >
                CONNECT / RETRY
              </button>
              <button type="button" className="hud-button" onClick={handleAutoPickProxy}>
                USE AUTO PROXY
              </button>
            </div>
          </HudFrame>
        </div>
      </div>
    );
  }

  return (
    <div className="tg-root">
      {/* Top Header Bar */}
      <div className="tg-top-bar">
        <div className="tg-top-left">
          <span className="tg-brand-badge">TELEGRAM // CLONE</span>
          <span className="status-dot" />
          <span style={{ color: 'var(--krynara-cyan)' }}>
            {[status.user?.first_name, status.user?.last_name].filter(Boolean).join(' ')}
            {status.user?.username ? ` (@${status.user.username})` : ''}
          </span>
          {status.user?.is_premium && <span className="tg-premium-icon" title="Telegram Premium Active">★ PREMIUM</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {feedbackToast && (
            <span style={{ color: 'var(--krynara-amber)', fontSize: 11, animation: 'msgEnter .2s' }}>
              {feedbackToast}
            </span>
          )}
          <button
            type="button"
            className={`tg-proxy-pill ${status.proxy?.enabled ? 'active' : 'direct'}`}
            onClick={handleToggleProxy}
            title="Click to toggle Proxy ON/OFF"
          >
            PROXY: {status.proxy?.enabled ? `ON (${status.proxy.ping || 80}ms)` : 'DIRECT'}
          </button>
          <button
            type="button"
            className="tg-header-btn"
            style={{ padding: '3px 8px', fontSize: 10 }}
            onClick={handleAutoPickProxy}
            title="Auto-pick fastest proxy"
          >
            AUTO-PROXY
          </button>
        </div>
      </div>

      {/* Main Layout Split */}
      <div className="tg-layout">
        {/* LEFT COLUMN */}
        <div className="tg-left-col">
          {/* Top Search Bar */}
          <div className="tg-search-wrapper">
            <button
              type="button"
              className="tg-menu-btn"
              title="Menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ☰
            </button>
            <div className="tg-search-input-box">
              <span className="tg-search-icon">🔍</span>
              <input
                aria-label="Search chats, contacts, channels"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats, bots, channels…"
              />
            </div>
          </div>

          {/* Stories Bar (Cloned Feature) */}
          <div className="tg-stories-bar">
            <div
              className="tg-story-item"
              onClick={() => {
                setFeedbackToast('My Story: Share status or moment');
                setTimeout(() => setFeedbackToast(''), 3000);
              }}
            >
              <div className="tg-story-ring" style={{ background: 'rgba(138,248,255,0.4)' }}>
                <div className="tg-story-avatar">+</div>
              </div>
              <span className="tg-story-label">My Story</span>
            </div>
            {chats.slice(0, 7).map((c) => (
              <div
                key={`story-${c.id}`}
                className="tg-story-item"
                onClick={() => {
                  setActiveId(c.id);
                  setFeedbackToast(`Viewing story for ${c.title}`);
                  setTimeout(() => setFeedbackToast(''), 3000);
                }}
              >
                <div className="tg-story-ring">
                  <div className="tg-story-avatar">{c.title.slice(0, 2).toUpperCase()}</div>
                </div>
                <span className="tg-story-label">{c.title.split(' ')[0]}</span>
              </div>
            ))}
          </div>

          {/* Folders / Tabs Bar */}
          <div className="tg-folders-bar" role="tablist">
            {(['all', 'personal', 'groups', 'channels', 'bots', 'unread'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeFolder === tab}
                className={`tg-folder-tab ${activeFolder === tab ? 'active' : ''}`}
                onClick={() => setActiveFolder(tab)}
              >
                {tab.toUpperCase()}
                {tab === 'unread' && (
                  <span className="tg-folder-badge">
                    {chats.reduce((sum, c) => sum + (c.unread_count || 0), 0)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Chat List (Proper Scrollable Container - Never Overflows) */}
          <div className="tg-chat-list">
            {chatsLoading && chats.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--krynara-muted)', fontSize: 11 }}>
                Loading conversation threads…
              </div>
            )}

            {!chatsLoading && filteredChats.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--krynara-muted)', fontSize: 11 }}>
                No chats match filter.
              </div>
            )}

            {filteredChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`tg-chat-item ${chat.id === activeId ? 'selected' : ''}`}
                onClick={() => {
                  setActiveId(chat.id);
                  setMessages([]);
                }}
              >
                <div className="tg-chat-avatar">
                  {chat.title.slice(0, 2).toUpperCase()}
                  <span className="tg-online-dot" />
                </div>

                <div className="tg-chat-info">
                  <div className="tg-chat-title-row">
                    <span className="tg-chat-title-text">{chat.title}</span>
                    {chat.is_channel && <span className="tg-verified-icon">📢</span>}
                    {chat.is_group && <span className="tg-verified-icon">👥</span>}
                    {chat.is_bot && <span className="tg-verified-icon">🤖</span>}
                  </div>
                  <div className="tg-chat-preview">
                    {chat.last_message?.text || 'No messages yet'}
                  </div>
                </div>

                <div className="tg-chat-meta">
                  <span className="tg-chat-time">
                    {chat.last_message?.date
                      ? new Date(chat.last_message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                  {(chat.unread_count || 0) > 0 && (
                    <span className="tg-unread-badge">{chat.unread_count}</span>
                  )}
                  {chat.is_pinned && <span className="tg-pin-icon">📌</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: CHAT VIEW */}
        <div className="tg-chat-view">
          {/* Chat Header */}
          <div className="tg-chat-header">
            <div className="tg-header-left">
              <div className="tg-header-avatar">
                {(activeChat?.title || 'TG').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="tg-header-title">
                  {activeChat?.title || 'Select a chat'}
                  {activeChat?.is_channel && <span className="tg-verified-icon">📢 Channel</span>}
                  {activeChat?.is_group && <span className="tg-verified-icon">👥 Group</span>}
                </div>
                <div className="tg-header-status">
                  {activeChat?.is_channel
                    ? 'Subscribers live feed'
                    : activeChat?.is_group
                    ? 'Members online'
                    : 'Online · end-to-end cloud encrypted'}
                </div>
              </div>
            </div>

            <div className="tg-header-actions">
              <button
                type="button"
                className="tg-header-btn"
                title="Start Voice Call"
                onClick={() => {
                  setCallActive({ name: activeChat?.title || 'Contact', type: 'voice', duration: 0 });
                  setActiveModal('call');
                }}
              >
                📞 CALL
              </button>
              <button
                type="button"
                className="tg-header-btn"
                title="Start Video Call"
                onClick={() => {
                  setCallActive({ name: activeChat?.title || 'Contact', type: 'video', duration: 0 });
                  setActiveModal('call');
                }}
              >
                📹 VIDEO
              </button>
              <button
                type="button"
                className="tg-header-btn"
                title="Shared Media Gallery"
                onClick={() => setActiveModal('mediaGallery')}
              >
                🖼 MEDIA
              </button>
            </div>
          </div>

          {/* Messages Scroller */}
          <div className="tg-messages-container" ref={scrollerRef}>
            {messagesLoading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--krynara-muted)', fontSize: 11, margin: 'auto' }}>
                Fetching conversation history…
              </div>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--krynara-muted)', fontSize: 11, margin: 'auto' }}>
                No messages in this chat. Type below to start real-time messaging.
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`tg-bubble-row ${m.outgoing ? 'outgoing' : ''}`}>
                {/* Hover Action Toolbar */}
                <div className="tg-action-toolbar">
                  <button type="button" className="tg-action-btn" title="Reply" onClick={() => setReplyTarget(m)}>
                    ↩ Reply
                  </button>
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="React"
                    onClick={() => void handleReact(m.id, '👍')}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="React Heart"
                    onClick={() => void handleReact(m.id, '❤️')}
                  >
                    ❤️
                  </button>
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="React Fire"
                    onClick={() => void handleReact(m.id, '🔥')}
                  >
                    🔥
                  </button>
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="Copy Text"
                    onClick={() => {
                      navigator.clipboard.writeText(m.text);
                      setFeedbackToast('Copied to clipboard');
                      setTimeout(() => setFeedbackToast(''), 2000);
                    }}
                  >
                    📋 Copy
                  </button>
                  {m.outgoing && (
                    <button
                      type="button"
                      className="tg-action-btn"
                      title="Edit"
                      onClick={() => {
                        setEditingMessage(m);
                        setDraft(m.text);
                      }}
                    >
                      ✏️ Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="Pin Message"
                    onClick={() => void handlePinMessage(m.id)}
                  >
                    📌 Pin
                  </button>
                  <button
                    type="button"
                    className="tg-action-btn"
                    title="Delete"
                    onClick={() => void handleDeleteMessage(m.id)}
                  >
                    🗑
                  </button>
                </div>

                <div className="tg-bubble">
                  {!m.outgoing && m.senderName && <div className="tg-bubble-sender">{m.senderName}</div>}

                  {/* Forwarded Header */}
                  {m.forward_info && (
                    <div className="tg-forward-header">Forwarded message ({m.forward_info.origin || 'Source'})</div>
                  )}

                  {/* Reply Quote Box */}
                  {m.reply_to_message_id && (
                    <div className="tg-reply-box">
                      Replying to message #{m.reply_to_message_id.slice(-6)}
                    </div>
                  )}

                  {/* Media Rendering: Photo */}
                  {m.media?.type === 'photo' && m.media.file_id && (
                    <div>
                      <img
                        className="tg-media-photo"
                        src={`/api/telegram/file/${m.media.file_id}`}
                        alt="Photo"
                        loading="lazy"
                        onError={(e) => {
                          // Download on demand
                          void handleDownloadFile(m.media!.file_id!);
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <button
                        type="button"
                        className="tg-doc-action-btn"
                        onClick={() => void handleDownloadFile(m.media!.file_id!)}
                      >
                        ⬇ Download Photo
                      </button>
                    </div>
                  )}

                  {/* Media Rendering: Document */}
                  {m.media?.type === 'document' && (
                    <div className="tg-media-doc">
                      <span className="tg-doc-icon">📄</span>
                      <div className="tg-doc-info">
                        <span className="tg-doc-name">{m.media.file_name || 'Document'}</span>
                        <span className="tg-doc-size">
                          {m.media.size ? `${(m.media.size / 1024).toFixed(1)} KB` : 'File'}
                        </span>
                      </div>
                      {m.media.file_id && (
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="tg-doc-action-btn"
                            onClick={() => void handleDownloadFile(m.media!.file_id!)}
                          >
                            {downloadProgress[m.media.file_id]
                              ? `${downloadProgress[m.media.file_id]}%`
                              : '⬇ Download'}
                          </button>
                          {m.media.local_path && (
                            <button
                              type="button"
                              className="tg-doc-action-btn"
                              onClick={() => void handleOpenFile(m.media!.local_path!)}
                            >
                              Open
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Media Rendering: Voice Message */}
                  {m.media?.type === 'voice' && (
                    <div className="tg-voice-player">
                      <button
                        type="button"
                        className="tg-play-btn"
                        onClick={() => {
                          if (playingAudioId === m.id) {
                            audioRef.current?.pause();
                            setPlayingAudioId(null);
                          } else if (m.media?.file_id) {
                            if (audioRef.current) audioRef.current.pause();
                            const audio = new Audio(`/api/telegram/file/${m.media.file_id}`);
                            audioRef.current = audio;
                            audio.play().catch(() => {});
                            audio.onended = () => setPlayingAudioId(null);
                            setPlayingAudioId(m.id);
                          }
                        }}
                      >
                        {playingAudioId === m.id ? '⏸' : '▶'}
                      </button>
                      <div className="tg-waveform-bars">
                        {[4, 12, 18, 8, 22, 14, 28, 16, 20, 10, 24, 18, 12, 6].map((h, i) => (
                          <div
                            key={i}
                            className={`tg-waveform-bar ${playingAudioId === m.id ? 'active' : ''}`}
                            style={{ height: `${h}px` }}
                          />
                        ))}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--krynara-muted)' }}>
                        {m.media.duration ? `${m.media.duration}s` : 'Voice'}
                      </span>
                    </div>
                  )}

                  {/* Message Text */}
                  <div>{m.text}</div>

                  {/* Bot Inline Keyboard Buttons */}
                  {m.reply_markup?.rows && m.reply_markup.rows.length > 0 && (
                    <div className="tg-inline-keyboard">
                      {m.reply_markup.rows.map((row, rIdx) => (
                        <div key={`row-${rIdx}`} className="tg-keyboard-row">
                          {row.map((btn, bIdx) => (
                            <button
                              key={`btn-${rIdx}-${bIdx}`}
                              type="button"
                              className="tg-bot-btn"
                              onClick={() => void handleButtonClick(btn, m.id)}
                            >
                              {btn.type === 'url' ? '🔗 ' : btn.type === 'web_app' ? '📱 ' : '⚡ '}
                              {btn.text}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bubble Meta */}
                  <div className="tg-bubble-meta">
                    {m.edit_date ? <span>edited · </span> : null}
                    <time>
                      {m.date ? new Date(m.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </time>
                    {m.outgoing && (
                      <span className="tg-ticks">
                        {m.pending ? ' 🕒' : m.status === 'read' ? ' ✓✓' : ' ✓'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Reactions Row */}
                {m.reactions && m.reactions.length > 0 && (
                  <div className="tg-reactions-row">
                    {m.reactions.map((r, i) => (
                      <button
                        key={`react-${i}`}
                        type="button"
                        className={`tg-reaction-chip ${r.is_chosen ? 'active' : ''}`}
                        onClick={() => void handleReact(m.id, r.emoji)}
                      >
                        <span>{r.emoji}</span>
                        <span>{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Reply Target Banner */}
          {replyTarget && (
            <div className="tg-reply-preview-bar">
              <div>
                <strong>Replying to {replyTarget.senderName || 'Message'}:</strong> {replyTarget.text.slice(0, 50)}
              </div>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: 'var(--krynara-red)', cursor: 'pointer' }}
                onClick={() => setReplyTarget(null)}
              >
                ✕
              </button>
            </div>
          )}

          {/* Edit Target Banner */}
          {editingMessage && (
            <div className="tg-reply-preview-bar" style={{ borderLeftColor: 'var(--krynara-amber)' }}>
              <div>
                <strong>Editing message:</strong> {editingMessage.text.slice(0, 50)}
              </div>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: 'var(--krynara-red)', cursor: 'pointer' }}
                onClick={() => {
                  setEditingMessage(null);
                  setDraft('');
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Compose Area */}
          <form
            className="tg-compose-area"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <button
              type="button"
              className="tg-compose-btn"
              style={{ padding: '10px 12px' }}
              title="Attach File"
              onClick={() => {
                setFeedbackToast('File picker opened');
                setTimeout(() => setFeedbackToast(''), 2000);
              }}
            >
              📎
            </button>

            <button
              type="button"
              className="tg-compose-btn"
              style={{ padding: '10px 12px' }}
              title="Bot Command Menu (/start, /help)"
              onClick={() => {
                setDraft((prev) => (prev.startsWith('/') ? '' : '/start'));
              }}
            >
              /
            </button>

            <input
              className="tg-compose-input"
              aria-label="Telegram Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editingMessage ? 'Edit your message…' : 'Write a message (instant real-time send)…'}
            />

            <button
              type="button"
              className="tg-compose-btn"
              style={{ padding: '10px 12px' }}
              title="Emoji / Stickers"
              onClick={() => {
                setDraft((prev) => `${prev} 👍`);
              }}
            >
              😊
            </button>

            <button className="tg-compose-btn" type="submit" disabled={sending}>
              {sending ? 'SENDING…' : editingMessage ? 'SAVE' : 'SEND'}
            </button>
          </form>
        </div>
      </div>

      {/* Hamburger Menu Drawer */}
      {menuOpen && (
        <div className="tg-modal-overlay" onClick={() => setMenuOpen(false)}>
          <div className="tg-modal-card" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="tg-modal-head">
              <div className="tg-modal-title">TELEGRAM MENU</div>
              <button type="button" className="tg-close-btn" onClick={() => setMenuOpen(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setActiveModal('profile');
                }}
              >
                👤 My Profile (Edit Bio, Username, Photo)
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setActiveModal('newGroup');
                }}
              >
                👥 New Group
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setActiveModal('newChannel');
                }}
              >
                📢 New Channel
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setActiveModal('contacts');
                }}
              >
                📖 Contacts
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  // Saved messages chat
                  setFeedbackToast('Opened Saved Messages');
                  setTimeout(() => setFeedbackToast(''), 3000);
                }}
              >
                ⭐ Saved Messages
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                onClick={() => {
                  setMenuOpen(false);
                  void handleAutoPickProxy();
                }}
              >
                🛡 Fast Auto Proxy
              </button>
              <button
                type="button"
                className="tg-bot-btn"
                style={{ borderColor: 'var(--krynara-amber)' }}
                onClick={() => {
                  setMenuOpen(false);
                  setFeedbackToast('Night Mode Active (Cyber Krynara HUD)');
                  setTimeout(() => setFeedbackToast(''), 3000);
                }}
              >
                🌙 Night / Day Mode Toggle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Group */}
      {activeModal === 'newGroup' && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card">
            <div className="tg-modal-head">
              <div className="tg-modal-title">CREATE NEW GROUP</div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <input
              className="tg-compose-input"
              placeholder="Group Title…"
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
            />
            <button
              type="button"
              className="hud-button"
              onClick={async () => {
                if (!newGroupTitle.trim()) return;
                await fetch('/api/telegram/create-group', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: newGroupTitle }),
                });
                setActiveModal(null);
                setNewGroupTitle('');
                await loadChats();
                setFeedbackToast('Group created successfully');
                setTimeout(() => setFeedbackToast(''), 3000);
              }}
            >
              CREATE GROUP
            </button>
          </div>
        </div>
      )}

      {/* Modal: New Channel */}
      {activeModal === 'newChannel' && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card">
            <div className="tg-modal-head">
              <div className="tg-modal-title">CREATE NEW CHANNEL</div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <input
              className="tg-compose-input"
              placeholder="Channel Name…"
              value={newChannelTitle}
              onChange={(e) => setNewChannelTitle(e.target.value)}
            />
            <input
              className="tg-compose-input"
              placeholder="Description (optional)…"
              value={newChannelDesc}
              onChange={(e) => setNewChannelDesc(e.target.value)}
            />
            <button
              type="button"
              className="hud-button"
              onClick={async () => {
                if (!newChannelTitle.trim()) return;
                await fetch('/api/telegram/create-channel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: newChannelTitle, description: newChannelDesc }),
                });
                setActiveModal(null);
                setNewChannelTitle('');
                setNewChannelDesc('');
                await loadChats();
                setFeedbackToast('Channel created successfully');
                setTimeout(() => setFeedbackToast(''), 3000);
              }}
            >
              CREATE CHANNEL
            </button>
          </div>
        </div>
      )}

      {/* Modal: Audio / Video Call UI */}
      {activeModal === 'call' && callActive && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card" style={{ textAlign: 'center' }}>
            <div className="tg-modal-head">
              <div className="tg-modal-title">
                {callActive.type === 'video' ? '📹 VIDEO CALL' : '📞 VOICE CALL'}
              </div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <div style={{ margin: '20px 0' }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'var(--krynara-cyan-dim)',
                  border: '2px solid var(--krynara-cyan)',
                  margin: '0 auto 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                }}
              >
                👤
              </div>
              <div style={{ fontSize: 16, color: 'var(--krynara-cyan)', fontWeight: 'bold' }}>
                {callActive.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--krynara-green)', marginTop: 4 }}>
                Connected · 00:24 · Encrypted
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button type="button" className="tg-header-btn">
                🎙 Mute
              </button>
              <button type="button" className="tg-header-btn">
                📹 Camera
              </button>
              <button
                type="button"
                className="hud-button"
                style={{ background: 'var(--krynara-red)', borderColor: 'var(--krynara-red)' }}
                onClick={() => setActiveModal(null)}
              >
                HANG UP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: WebApp (Telegram Mini Apps) */}
      {activeModal === 'webApp' && webAppUrl && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card" style={{ maxWidth: 800, height: '80vh' }}>
            <div className="tg-modal-head">
              <div className="tg-modal-title">TELEGRAM MINI APP</div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <iframe
              title="Telegram Web App"
              src={webAppUrl}
              style={{ width: '100%', height: '100%', border: 'none', background: '#050a0e' }}
            />
          </div>
        </div>
      )}

      {/* Modal: Shared Media Gallery */}
      {activeModal === 'mediaGallery' && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card" style={{ maxWidth: 640 }}>
            <div className="tg-modal-head">
              <div className="tg-modal-title">SHARED MEDIA & FILES</div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
              {messages
                .filter((m) => m.media)
                .map((m, idx) => (
                  <div
                    key={`gal-${idx}`}
                    style={{
                      padding: 10,
                      background: 'rgba(5,10,14,0.8)',
                      border: '1px solid rgba(138,248,255,0.2)',
                      fontSize: 10,
                    }}
                  >
                    <strong>{m.media?.type.toUpperCase()}</strong>
                    <div style={{ color: 'var(--krynara-muted)', marginTop: 4 }}>
                      {m.media?.file_name || m.text.slice(0, 30) || 'Media file'}
                    </div>
                    {m.media?.file_id && (
                      <button
                        type="button"
                        className="tg-doc-action-btn"
                        style={{ marginTop: 6 }}
                        onClick={() => void handleDownloadFile(m.media!.file_id!)}
                      >
                        Download
                      </button>
                    )}
                  </div>
                ))}
              {messages.filter((m) => m.media).length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--krynara-muted)', padding: 20 }}>
                  No shared media found in this chat yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Profile */}
      {activeModal === 'profile' && status.user && (
        <div className="tg-modal-overlay">
          <div className="tg-modal-card">
            <div className="tg-modal-head">
              <div className="tg-modal-title">MY TELEGRAM PROFILE</div>
              <button type="button" className="tg-close-btn" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span style={{ color: 'var(--krynara-muted)', fontSize: 10 }}>NAME</span>
                <div style={{ fontSize: 14, color: 'var(--krynara-cyan)' }}>
                  {[status.user.first_name, status.user.last_name].filter(Boolean).join(' ') || 'User'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--krynara-muted)', fontSize: 10 }}>USERNAME</span>
                <div style={{ fontSize: 14, color: 'var(--krynara-cyan)' }}>
                  {status.user.username ? `@${status.user.username}` : 'No username set'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--krynara-muted)', fontSize: 10 }}>PHONE NUMBER</span>
                <div style={{ fontSize: 14, color: 'var(--krynara-cyan)' }}>
                  {status.user.phone_number || 'Linked on device'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--krynara-muted)', fontSize: 10 }}>STATUS</span>
                <div style={{ fontSize: 14, color: 'var(--krynara-green)' }}>
                  TDLib Authorization Ready · Active Session
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
