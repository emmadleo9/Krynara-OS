import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { colorFor, initialsOf, timeHM, dayLabel, EMOJIS } from '../utils'

function Ticks({ status }) {
  // sent = single grey tick, delivered/read = double tick
  const delivered = status === 'delivered' || status === 'read'
  const read = status === 'read'
  const color = read ? '#64b5ef' : '#708499'
  if (status === 'sending') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" className="inline-block opacity-60" fill="none" stroke="#a8c4dd" strokeWidth="2">
        <circle cx="12" cy="12" r="9" strokeDasharray="40 20" />
      </svg>
    )
  }
  return (
    <svg width="18" height="12" viewBox="0 0 24 16" fill="none" stroke={color} strokeWidth="2" className="inline-block">
      {delivered && <path d="M1 8.5l4.5 4.5L14 4.5" />}
      {!delivered && <path d="M4 8.5l4.5 4.5L17 4.5" />}
      {delivered && <path d="M8 8.5l4.5 4.5L21 4.5" />}
    </svg>
  )
}

export default function ChatScreen({ me, peer, onBack }) {
  const [messages, setMessages] = useState([]) // {id, sender_id, text, created_at, status}
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)
  const typingTimeout = useRef(null)
  const typingChannelRef = useRef(null)

  // ---- Load history ----
  const loadHistory = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${me.id},receiver_id.eq.${peer.id}),and(sender_id.eq.${peer.id},receiver_id.eq.${me.id})`,
      )
      .order('created_at', { ascending: true })
      .limit(500)
    if (err) { setError(err.message); return }
    setMessages(data || [])
  }, [me.id, peer.id])

  useEffect(() => {
    setMessages([]); setText(''); setShowEmoji(false); setError('')
    loadHistory()
  }, [loadHistory])

  // ---- Realtime subscription ----
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${me.id}-${peer.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          const relevant =
            (m.sender_id === me.id && m.receiver_id === peer.id) ||
            (m.sender_id === peer.id && m.receiver_id === me.id)
          if (!relevant) return
          setMessages((prev) => {
            // Replace optimistic copy (temp id) if present
            const idx = prev.findIndex(
              (x) => x._temp && x.text === m.text && x.sender_id === m.sender_id,
            )
            if (idx !== -1) {
              const copy = [...prev]
              copy[idx] = { ...m, status: 'delivered' }
              return copy
            }
            if (prev.some((x) => x.id === m.id)) return prev
            return [...prev, m]
          })
          // If message is incoming and I'm viewing this chat -> mark read immediately
          if (m.receiver_id === me.id) {
            supabase.from('messages').update({ read: true }).eq('id', m.id).then(() => {})
            setMessages((prev) =>
              prev.map((x) => (x.id === m.id ? { ...x, read: true } : x)),
            )
          }
        },
      )
      // Receive updates (delivered/read ticks)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          setMessages((prev) =>
            prev.map((x) =>
              x.id === m.id
                ? { ...m, status: m.read ? 'read' : 'delivered' }
                : x,
            ),
          )
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [me.id, peer.id])

  // ---- Typing indicator (presence broadcast) ----
  useEffect(() => {
    const room = supabase.channel(`typing-${[me.id, peer.id].sort().join('-')}`, {
      config: { broadcast: { self: false } },
    })
    typingChannelRef.current = room
    room.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId !== me.id) {
        setPeerTyping(payload.typing)
      }
    }).subscribe()
    return () => { supabase.removeChannel(room) }
  }, [me.id, peer.id])

  function broadcastTyping(isTyping) {
    typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: me.id, typing: isTyping },
    })
  }

  function handleInput(e) {
    setText(e.target.value)
    broadcastTyping(true)
    clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => broadcastTyping(false), 1500)
  }

  // ---- Mark all incoming as read when chat opens ----
  useEffect(() => {
    (async () => {
      await supabase
        .from('messages')
        .update({ read: true })
        .eq('sender_id', peer.id)
        .eq('receiver_id', me.id)
        .eq('read', false)
      setMessages((prev) => prev.map((m) => (m.sender_id === peer.id ? { ...m, read: true } : m)))
    })()
  }, [peer.id, me.id, messages.length])

  // Auto scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length, peerTyping])

  // ---- Send ----
  async function send(e) {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText(''); setShowEmoji(false); broadcastTyping(false)
    clearTimeout(typingTimeout.current)

    const tempId = `temp-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { _temp: true, id: tempId, sender_id: me.id, receiver_id: peer.id, text: body, created_at: new Date().toISOString(), status: 'sending' },
    ])

    const { data, error: err } = await supabase
      .from('messages')
      .insert({ sender_id: me.id, receiver_id: peer.id, text: body })
      .select()
      .single()

    if (err) {
      setError(`Failed to send: ${err.message}`)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      return
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...data, status: 'sent' } : m)),
    )
  }

  // Group messages into day sections
  const groups = []
  for (const m of messages) {
    const label = dayLabel(m.created_at)
    const g = groups[groups.length - 1]
    if (!g || g.label !== label) groups.push({ label, items: [m] })
    else g.items.push(m)
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 md:px-4 py-2 bg-tg-sidebar border-b border-black/30 shrink-0">
        <button onClick={onBack} className="md:hidden p-1 -ml-1" title="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
          style={{ background: colorFor(peer.id) }}
        >
          {initialsOf(peer.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate leading-tight">{peer.name}</div>
          <div className="text-xs text-[#708499] truncate leading-tight">
            {peerTyping ? (
              <span className="text-tg-accent">typing…</span>
            ) : (
              <>@{peer.username}</>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 md:px-16 lg:px-40 py-4 space-y-0.5">
        {error && <p className="text-red-400 text-xs text-center mb-2">{error}</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="sticky top-0 flex justify-center my-3 z-10">
              <span className="text-xs text-gray-300 bg-[#1c2733]/90 backdrop-blur px-3 py-1 rounded-full">
                {g.label}
              </span>
            </div>
            {g.items.map((m) => {
              const mine = m.sender_id === me.id
              const prev = g.items[g.items.indexOf(m) - 1]
              const grouped = prev && prev.sender_id === m.sender_id &&
                new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? '' : 'mt-2'}`}>
                  <div
                    className={`max-w-[75%] md:max-w-[55%] px-3 py-1.5 text-[15px] leading-snug rounded-2xl break-words whitespace-pre-wrap ${
                      mine
                        ? 'bg-tg-mine rounded-br-md'
                        : 'bg-tg-theirs rounded-bl-md'
                    }`}
                  >
                    {m.text}
                    <span className="inline-flex items-center gap-1 align-bottom float-right ml-2 mt-0.5">
                      <span className="text-[11px] text-white/50">{timeHM(m.created_at)}</span>
                      {mine && <Ticks status={m.status ?? (m.read ? 'read' : m.delivered ? 'delivered' : 'sent')} />}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {peerTyping && (
          <div className="flex justify-start">
            <div className="bg-tg-theirs rounded-2xl rounded-bl-md px-4 py-2 flex gap-1">
              <span className="w-2 h-2 rounded-full bg-[#708499] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#708499] animate-bounce" style={{ animationDelay: '120ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#708499] animate-bounce" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Emoji picker */}
      {showEmoji && (
        <div className="mx-3 md:mx-16 lg:mx-40 mb-1 bg-tg-hover rounded-lg p-2 grid grid-cols-10 gap-1">
          {EMOJIS.map((e, i) => (
            <button
              key={i}
              onClick={() => setText((t) => t + e)}
              className="text-xl hover:bg-tg-active rounded p-1"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} className="flex items-end gap-2 px-3 md:px-4 py-3 bg-tg-sidebar shrink-0">
        <button type="button" onClick={() => setShowEmoji((v) => !v)} className="p-2 text-[#708499] hover:text-white shrink-0" title="Emoji">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" /><path d="M8.5 14s1.2 1.5 3.5 1.5S15.5 14 15.5 14" strokeLinecap="round" />
            <circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className="p-2 text-[#708499] hover:text-white shrink-0" title="Attach" onClick={() => alert('Attachments are not part of this demo')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" />
          </svg>
        </button>
        <textarea
          rows={1}
          value={text}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          placeholder="Message"
          className="flex-1 resize-none max-h-32 bg-tg-input rounded-2xl px-4 py-2.5 outline-none text-[15px] placeholder:text-[#708499]"
        />
        <button type="submit" className={`p-2 shrink-0 ${text.trim() ? 'text-tg-accent' : 'text-[#708499] hover:text-white'}`} title="Send">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
