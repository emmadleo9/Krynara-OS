import React, { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { colorFor, initialsOf, chatListTime } from '../utils'

export default function Sidebar({ me, users, activePeerId, onSelect, onNewChat, onLogout }) {
  const [search, setSearch] = useState('')
  const [lastByUser, setLastByUser] = useState({}) // peerId -> { text, created_at, sender_id }
  const [unread, setUnread] = useState({}) // peerId -> count
  const [online, setOnline] = useState({}) // userId -> last_seen
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Load last message + unread count for every chat
  useEffect(() => {
    if (!me) return
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('sender_id, receiver_id, text, created_at')
        .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled || !data) return

      const last = {}
      const unreadCounts = {}
      for (const m of data) {
        const peerId = m.sender_id === me.id ? m.receiver_id : m.sender_id
        if (!last[peerId]) last[peerId] = m
        if (m.receiver_id === me.id && !m.read) unreadCounts[peerId] = (unreadCounts[peerId] || 0) + 1
      }
      setLastByUser(last)
      setUnread(unreadCounts)
    }
    load()

    // Realtime: update list preview + unread badges live
    const channel = supabase
      .channel('sidebar')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          if (!m) return
          if (m.sender_id !== me.id && m.receiver_id !== me.id) return
          const peerId = m.sender_id === me.id ? m.receiver_id : m.sender_id
          setLastByUser((prev) => {
            const cur = prev[peerId]
            if (cur && new Date(cur.created_at) > new Date(m.created_at)) return prev
            return { ...prev, [peerId]: m }
          })
          if (m.receiver_id === me.id) {
            setUnread((prev) => ({
              ...prev,
              [peerId]: (prev[peerId] || 0) + 1,
            }))
          }
        },
      )
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [me])

  // When opening a chat, reset its unread badge
  useEffect(() => {
    if (activePeerId) setUnread((prev) => ({ ...prev, [activePeerId]: 0 }))
  }, [activePeerId])

  // Presence: who is online
  useEffect(() => {
    if (!me) return
    const room = supabase.channel('presence', { config: { presence: { key: me.id } } })
    room
      .on('presence', { event: 'sync' }, () => {
        const state = room.presenceState()
        const map = {}
        for (const [id, arr] of Object.entries(state)) map[id] = arr[0]?.online_at
        setOnline(map)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          room.track({ online_at: new Date().toISOString() })
        }
      })
    return () => { supabase.removeChannel(room) }
  }, [me])

  useEffect(() => {
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users
      .filter((u) => !q || u.name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = lastByUser[a.id]?.created_at || 0
        const tb = lastByUser[b.id]?.created_at || 0
        return new Date(tb) - new Date(ta)
      })
  }, [users, search, lastByUser])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold hover:opacity-90"
            style={{ background: colorFor(me.id) }}
            title={me.name}
          >
            {initialsOf(me.name)}
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-12 z-30 bg-tg-hover rounded-lg shadow-xl py-1.5 w-44 border border-black/30">
              <div className="px-4 py-1.5 text-xs text-gray-400">Signed in as</div>
              <div className="px-4 pb-2 text-sm font-medium">@{me.username}</div>
              <button
                onClick={onLogout}
                className="w-full text-left px-4 py-2 text-sm hover:bg-tg-active/60"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="flex-1 ml-3">
          <div className="flex items-center bg-tg-input rounded-full px-3 py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#708499" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="bg-transparent outline-none ml-2 w-full text-sm placeholder:text-[#708499]"
            />
          </div>
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 && (
          <p className="text-center text-sm text-gray-500 mt-10 px-4">
            No chats yet. Tap the ✏️ button to start one.
          </p>
        )}
        {list.map((u) => {
          const last = lastByUser[u.id]
          const isActive = u.id === activePeerId
          const isOnline = Boolean(online[u.id])
          return (
            <button
              key={u.id}
              onClick={() => onSelect(u)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${isActive ? 'bg-tg-active' : 'hover:bg-tg-hover'
                }`}
            >
              <div className="relative shrink-0">
                <div
                  className="w-[54px] h-[54px] rounded-full flex items-center justify-center text-lg font-medium"
                  style={{ background: colorFor(u.id) }}
                >
                  {initialsOf(u.name)}
                </div>
                {isOnline && (
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-tg-green border-2 border-tg-sidebar" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-medium truncate">{u.name}</span>
                  {last && (
                    <span className={`text-xs shrink-0 ${isActive ? 'text-white/70' : 'text-[#708499]'}`}>
                      {chatListTime(last.created_at)}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className={`text-sm truncate ${isActive ? 'text-white/80' : 'text-[#708499]'}`}>
                    {last
                      ? `${last.sender_id === me.id ? 'You: ' : ''}${last.text}`
                      : 'No messages yet'}
                  </span>
                  {unread[u.id] > 0 && (
                    <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-tg-accent text-tg-sidebar text-xs font-semibold flex items-center justify-center">
                      {unread[u.id] > 99 ? '99+' : unread[u.id]}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* New chat FAB */}
      <button
        onClick={onNewChat}
        className="absolute md:fixed bottom-5 right-5 md:right-[calc(100%-340px-20px)] lg:right-[calc(100%-380px-20px)] w-14 h-14 rounded-full bg-[#3390ec] hover:bg-[#2f86dd] shadow-lg flex items-center justify-center z-20"
        title="New chat"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1-4L16.5 3.5z" />
        </svg>
      </button>
    </div>
  )
}
