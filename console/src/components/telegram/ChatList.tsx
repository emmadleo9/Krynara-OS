import { useEffect, useRef } from 'react';
import type { TgChat } from '@/features/social/TelegramLive';
import './telegram-clone.css';

export const ChatList = ({
  chats,
  activeChatId,
  onSelect,
}: {
  chats: TgChat[];
  activeChatId: string;
  onSelect: (id: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep scroll at top; not needed for list but placeholder for future virtualisation
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [chats]);

  return (
    <div className="chat-list" ref={containerRef} style={{ height: 'calc(100vh - 200px)', overflowY: 'auto' }}>
      {chats.map((c) => (
        <div
          key={c.id}
          className={c.id === activeChatId ? 'chat-list-item selected' : 'chat-list-item'}
          onClick={() => onSelect(c.id)}
        >
          <span className="chat-list-title">
            {c.title}
            {c.unread_count && c.unread_count > 0 && <span className="unread-dot" />}
          </span>
          <span className="chat-list-preview">{c.last_message?.text ?? ''}</span>
        </div>
      ))}
    </div>
  );
};
