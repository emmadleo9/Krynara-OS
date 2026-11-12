import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { HudFrame } from '@/components/hud';
import { KrynaraWhatsApp } from '@/features/social/KrynaraWhatsApp';
import { TelegramLive } from '@/features/social/TelegramLive';

type Platform = 'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM' | 'DISCORD';
type Message = { id: number; sender: string; text: string; time: string; outgoing?: boolean };
type Chat = { id: string; name: string; preview: string; unread: number; messages: Message[] };
type IntegrationStatus = 'unknown' | 'online' | 'offline';

const platforms: Platform[] = ['WHATSAPP', 'TELEGRAM', 'INSTAGRAM', 'DISCORD'];
const fields = [
  { key: 'telegram_bot_token', label: 'TELEGRAM BOT TOKEN', platform: 'TELEGRAM' as const, secret: true },
  { key: 'instagram_user_id', label: 'INSTAGRAM USER ID', platform: 'INSTAGRAM' as const },
  { key: 'instagram_token', label: 'INSTAGRAM ACCESS TOKEN', platform: 'INSTAGRAM' as const, secret: true },
  { key: 'discord_bot_token', label: 'DISCORD BOT TOKEN', platform: 'DISCORD' as const, secret: true },
] as const;
type CredentialKey = typeof fields[number]['key'];
type Credentials = Record<CredentialKey, string>;

const emptyCredentials: Credentials = {
  telegram_bot_token: '',
  instagram_user_id: '',
  instagram_token: '',
  discord_bot_token: '',
};

const seedChats: Record<Platform, Chat[]> = {
  WHATSAPP: [
    { id: 'wa-1', name: 'Project coordination', preview: 'Status update received', unread: 2, messages: [{ id: 1, sender: 'Amina', text: 'Status update received', time: '10:24' }, { id: 2, sender: 'You', text: 'Acknowledged.', time: '10:26', outgoing: true }] },
    { id: 'wa-2', name: 'Field team', preview: 'Briefing is ready', unread: 0, messages: [{ id: 3, sender: 'Field team', text: 'Briefing is ready for review.', time: '09:41' }] },
  ],
  TELEGRAM: [
    { id: 'tg-1', name: 'Operations channel', preview: 'Daily summary posted', unread: 1, messages: [{ id: 1, sender: 'Operations', text: 'Daily summary posted.', time: '11:03' }] },
    { id: 'tg-2', name: 'Research notes', preview: 'Source list updated', unread: 0, messages: [{ id: 2, sender: 'Research', text: 'Source list updated.', time: '08:16' }] },
  ],
  INSTAGRAM: [
    { id: 'ig-1', name: 'Community inbox', preview: 'Thanks for the update', unread: 0, messages: [{ id: 1, sender: 'Community', text: 'Thanks for the update.', time: '12:02' }] },
    { id: 'ig-2', name: 'Public page', preview: 'New comment received', unread: 3, messages: [{ id: 2, sender: 'Public page', text: 'New comment received.', time: '09:20' }] },
  ],
  DISCORD: [
    { id: 'dc-1', name: 'krynara / general', preview: 'Welcome to the workspace', unread: 0, messages: [{ id: 1, sender: 'Moderator', text: 'Welcome to the workspace.', time: '10:51' }] },
    { id: 'dc-2', name: 'krynara / research', preview: 'Links are in the thread', unread: 1, messages: [{ id: 2, sender: 'Research team', text: 'Links are in the thread.', time: '07:38' }] },
  ],
};

function readCredentials(): Credentials {
  return fields.reduce((result, field) => {
    result[field.key] = localStorage.getItem(field.key) ?? '';
    return result;
  }, { ...emptyCredentials });
}

export function SocialHub() {
  const [platform, setPlatform] = useState<Platform>('WHATSAPP');
  const [credentials, setCredentials] = useState<Credentials>(readCredentials);
  const [statuses, setStatuses] = useState<Record<Platform, IntegrationStatus>>({ WHATSAPP: 'unknown', TELEGRAM: 'unknown', INSTAGRAM: 'unknown', DISCORD: 'unknown' });
  const [chatId, setChatId] = useState(seedChats.WHATSAPP[0].id);
  const [chats, setChats] = useState(seedChats);
  const [draft, setDraft] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const selectedChats = chats[platform];
  const selectedChat = useMemo(() => selectedChats.find((chat) => chat.id === chatId) ?? selectedChats[0], [chatId, selectedChats]);

  useEffect(() => {
    fetch('/api/telegram/status')
      .then((r) => r.json())
      .then((data: { authorized?: boolean }) => {
        if (data.authorized) setStatuses((s) => ({ ...s, TELEGRAM: 'online' }));
      })
      .catch(() => {});
  }, []);

  const saveCredential = (key: CredentialKey, value: string) => {
    localStorage.setItem(key, value);
    setCredentials((current) => ({ ...current, [key]: value }));
    setStatuses((current) => ({ ...current, [platform]: 'unknown' }));
  };

  const testConnection = async () => {
    setTesting(true);
    setTestMessage('');
    try {
      if (platform === 'TELEGRAM') {
        const response = await fetch('/api/telegram/status');
        const data = await response.json() as { authorized?: boolean; user?: { first_name?: string; username?: string }; error?: string };
        if (data.authorized) {
          setStatuses((current) => ({ ...current, TELEGRAM: 'online' }));
          setTestMessage(`Connected to Telegram via TDLib as ${data.user?.first_name || 'User'}${data.user?.username ? ` (@${data.user.username})` : ''}.`);
        } else {
          setStatuses((current) => ({ ...current, TELEGRAM: 'offline' }));
          setTestMessage(data.error || 'Telegram session is not authorized. Link account in Settings > Telegram.');
        }
        return;
      }

      let url = '';
      const headers = new Headers();
      if (platform === 'INSTAGRAM') {
        const { instagram_user_id: userId, instagram_token: token } = credentials;
        if (!userId || !token) throw new Error('Enter the Instagram user ID and access token first.');
        url = `https://graph.facebook.com/v23.0/${encodeURIComponent(userId)}?fields=id,username`;
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        if (!credentials.discord_bot_token) throw new Error('Enter the Discord bot token first.');
        url = 'https://discord.com/api/v10/users/@me';
        headers.set('Authorization', `Bot ${credentials.discord_bot_token}`);
      }

      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`Official API returned HTTP ${response.status}`);
      const body = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (body.ok === false) throw new Error(body.error?.message || 'The platform rejected the credentials.');
      setStatuses((current) => ({ ...current, [platform]: 'online' }));
      setTestMessage('Connection verified by the official platform API.');
    } catch (reason) {
      setStatuses((current) => ({ ...current, [platform]: 'offline' }));
      setTestMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTesting(false);
    }
  };

  const sendLocalMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedChat) return;
    setChats((current) => ({
      ...current,
      [platform]: current[platform].map((chat) => chat.id === selectedChat.id
        ? { ...chat, preview: text, messages: [...chat.messages, { id: Date.now(), sender: 'You', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), outgoing: true }] }
        : chat),
    }));
    setDraft('');
  };

  return (
    <div className={`social-page${platform === 'WHATSAPP' ? ' social-page-whatsapp' : ''}`}>
      <div className="social-tabs" role="tablist" aria-label="Messaging platform">
        {platforms.map((item) => (
          <button type="button" role="tab" aria-selected={platform === item} className={platform === item ? 'social-tab active' : 'social-tab'} key={item} onClick={() => {
            setPlatform(item);
            if (item !== 'WHATSAPP') setChatId(seedChats[item][0].id);
            setTestMessage('');
          }}>
            {item === 'WHATSAPP' ? 'KRYNARA WHATSAPP' : item}
          </button>
        ))}
      </div>
      {platform === 'WHATSAPP' ? <KrynaraWhatsApp /> : platform === 'TELEGRAM' ? <TelegramLive /> : <div className="social-workspace">
        <HudFrame title={`${platform} // CONVERSATIONS`} className="social-chat-list">
          {selectedChats.map((chat) => (
            <button type="button" className={chat.id === chatId ? 'chat-list-item selected' : 'chat-list-item'} key={chat.id} onClick={() => setChatId(chat.id)}>
              <span className="chat-list-title">{chat.name}{chat.unread > 0 && <span className="unread-dot" />}</span>
              <span className="chat-list-preview">{chat.preview}</span>
            </button>
          ))}
          <div className="social-local-note">DEMO THREADS ARE LOCAL ONLY</div>
        </HudFrame>

        <HudFrame title={selectedChat?.name ?? platform} className="social-chat">
          <div className="chat-messages" aria-live="polite">
            {selectedChat?.messages.map((message) => (
              <div key={message.id} className={message.outgoing ? 'chat-bubble outgoing' : 'chat-bubble'}>
                <div>{message.text}</div><time>{message.sender} · {message.time}</time>
              </div>
            ))}
          </div>
          <form className="chat-compose" onSubmit={sendLocalMessage}>
            <input aria-label="Local demo message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a local demo message…" />
            <button className="hud-button" type="submit">ADD</button>
          </form>
        </HudFrame>

        <HudFrame title={`${platform} // CONNECTION`} className="social-settings">
          <div className="integration-status">
            <span className={`status-dot ${statuses[platform] === 'offline' ? 'status-dot-offline' : ''}`} />
            {statuses[platform] === 'unknown' ? 'NOT TESTED' : statuses[platform].toUpperCase()}
          </div>
          {fields.filter((field) => field.platform === platform).map((field) => (
            <label className="credential-field" key={field.key}>
              <span>{field.label}</span>
              <input
                type={'secret' in field ? 'password' : 'text'}
                autoComplete="off"
                value={credentials[field.key]}
                onChange={(event) => saveCredential(field.key, event.target.value)}
                placeholder="Stored in this browser only"
              />
            </label>
          ))}
          <button type="button" className="hud-button connect-button" onClick={() => void testConnection()} disabled={testing}>
            {testing ? 'CHECKING OFFICIAL API…' : 'TEST CONNECTION'}
          </button>
          {testMessage && <p className="connection-message" role="status">{testMessage}</p>}
          <p className="credential-notice">Credentials remain in local browser storage and are sent only to the matching official platform API during a connection test.</p>
        </HudFrame>
      </div>}
    </div>
  );
}
