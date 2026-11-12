import React, { useState } from 'react'
import { supabase } from '../supabaseClient'
import { colorFor, initialsOf } from '../utils'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!uname) { setError('Enter a username'); return }
    setLoading(true); setError('')

    // Try to find existing user
    let { data: user } = await supabase.from('users').select('*').eq('username', uname).maybeSingle()

    // Create if new
    if (!user) {
      const insert = await supabase
        .from('users')
        .insert({ username: uname, name: username.trim() })
        .select()
        .single()
      if (insert.error) {
        setError(insert.error.message)
        setLoading(false)
        return
      }
      user = insert.data
    }

    setLoading(false)
    onLogin(user)
  }

  return (
    <div className="h-full flex items-center justify-center bg-tg-bg px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-tg-sidebar rounded-xl p-8 space-y-5 shadow-2xl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
            style={{ background: 'linear-gradient(135deg,#2AABEE,#229ED9)' }}>
            <svg width="40" height="40" viewBox="0 0 100 100" fill="white">
              <path d="M22 49l52-21-9 44-13-9-9 9-2-13z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">Sign in to Telegram</h1>
          <p className="text-sm text-gray-400 text-center">Enter your username. A new username creates a new account automatically.</p>
        </div>

        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username (e.g. alice)"
          className="w-full bg-tg-input rounded-lg px-4 py-3 outline-none border border-transparent focus:border-tg-accent transition-colors"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          disabled={loading}
          className="w-full bg-[#3390ec] hover:bg-[#2f86dd] disabled:opacity-60 text-white font-medium rounded-lg py-3 transition-colors"
        >
          {loading ? 'Signing in…' : 'CONTINUE'}
        </button>

        {username.trim() && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{ background: colorFor(username) }}
            >
              {initialsOf(username)}
            </span>
            Signing in as <b className="text-gray-200">{username.trim().toLowerCase()}</b>
          </div>
        )}
      </form>
    </div>
  )
}
