import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, supabaseReady } from './supabaseClient'
import Login from './components/Login.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChatScreen from './components/ChatScreen.jsx'
import NewChatModal from './components/NewChatModal.jsx'

export default function App() {
  const [me, setMe] = useState(null) // { id, username, name }
  const [users, setUsers] = useState([])
  const [activePeer, setActivePeer] = useState(null) // peer user object
  const [showNewChat, setShowNewChat] = useState(false)
  const [mobileView, setMobileView] = useState('list') // 'list' | 'chat'
  const [dbError, setDbError] = useState(false)

  // Restore session from localStorage
  useEffect(() => {
    const raw = localStorage.getItem('tg_me')
    if (raw) {
      try { setMe(JSON.parse(raw)) } catch { /* ignore */ }
    }
  }, [])

  // Load all users
  const loadUsers = useCallback(async () => {
    if (!supabaseReady || !me) return
    const { data, error } = await supabase.from('users').select('*').neq('id', me.id).order('username')
    if (error) {
      console.error('loadUsers', error)
      if (error.message.includes('relation') || error.code === '42P01') setDbError(true)
      return
    }
    setUsers(data || [])
  }, [me])

  useEffect(() => { loadUsers() }, [loadUsers])

  // Re-check users when window regains focus (cheap way to see new signups)
  useEffect(() => {
    const onFocus = () => loadUsers()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadUsers])

  async function handleLogin(user) {
    setMe(user)
    localStorage.setItem('tg_me', JSON.stringify(user))
  }

  function handleLogout() {
    localStorage.removeItem('tg_me')
    setMe(null)
    setActivePeer(null)
    setMobileView('list')
  }

  if (!supabaseReady) {
    return (
      <div className="h-full flex items-center justify-center bg-tg-bg px-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-semibold">Supabase not configured</h1>
          <p className="text-sm text-gray-400">
            Create <code className="text-tg-accent">.env</code> in <code className="text-tg-accent">telegram-clone/</code> with
            your <code className="text-tg-accent">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-tg-accent">VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.
            See SETUP.md.
          </p>
        </div>
      </div>
    )
  }

  if (!me) return <Login onLogin={handleLogin} />

  return (
    <div className="h-full flex bg-tg-bg overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${mobileView === 'chat' ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] lg:w-[380px] shrink-0 flex-col border-r border-black/40 bg-tg-sidebar`}
      >
        <Sidebar
          me={me}
          users={users}
          activePeerId={activePeer?.id}
          onSelect={(u) => { setActivePeer(u); setMobileView('chat') }}
          onNewChat={() => setShowNewChat(true)}
          onLogout={handleLogout}
        />
      </div>

      {/* Chat area */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}>
        {activePeer ? (
          <ChatScreen me={me} peer={activePeer} dbError={dbError} onBack={() => setMobileView('list')} />
        ) : (
          <div className="flex-1 hidden md:flex items-center justify-center flex-col gap-2 text-gray-500">
            <div className="w-24 h-24 rounded-full bg-tg-hover flex items-center justify-center text-4xl">💬</div>
            <p>Select a chat to start messaging</p>
          </div>
        )}
      </div>

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onCreated={(peer) => { setShowNewChat(false); loadUsers(); setActivePeer(peer); setMobileView('chat') }}
        />
      )}
    </div>
  )
}
