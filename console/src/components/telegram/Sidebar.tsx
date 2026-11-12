import { useState } from 'react';
import { useTelegramStatus } from '@/hooks/useTelegramStatus';
import './telegram-clone.css';

export const Sidebar = ({ onSelectChat: _onSelectChat }: { onSelectChat: (chatId: string) => void }) => {
  const [search, setSearch] = useState('');
  const { status: tgStatus } = useTelegramStatus();
  const folders = ['All Chats', 'Personal', 'Groups', 'Channels', 'Bots']; // placeholder
  const handleFolderClick = (_folder: string) => {
    // TODO: filter chats by folder – for now no-op
  };

  return (
    <div className="tg-left-col">
      <div className="tg-top-bar">
        <div className="tg-brand-badge">
          <span>Telegram</span>
        </div>
        <div className={`tg-proxy-pill ${tgStatus?.proxy?.enabled ? 'active' : ''}`} onClick={() => {}}> {/* placeholder */}
          {tgStatus?.proxy?.enabled ? 'Proxy ON' : 'Proxy OFF'}
        </div>
      </div>
      <div className="tg-search-wrapper">
        <div className="tg-search-icon">🔍</div>
        <input
          type="text"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="tg-search-input-box"
        />
      </div>
      <div className="tg-stories-bar">
        {/* stories placeholder – could map over status.user?.is_premium */}
        {tgStatus?.user?.is_premium && (
          <div className="tg-story-item">
            <div className="tg-story-ring">
              <div className="tg-story-avatar">⭐</div>
            </div>
            <div className="tg-story-label">Premium</div>
          </div>
        )}
      </div>
      <div className="tg-folder-tabs" style={{ display: 'flex', padding: '8px', gap: '8px' }}>
        {folders.map((f) => (
          <button key={f} className="hud-button" onClick={() => handleFolderClick(f)}>
            {f}
          </button>
        ))}
      </div>
    </div>
  );
};
