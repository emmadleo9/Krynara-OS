import React, { useState } from 'react'
import { supabase } from '../supabaseClient'
import { colorFor, initialsOf } from '../utils'

export default function NewChatModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(e) {
    e.preventDefault()
    const displayName = name.trim()
    if (!displayName) return
    setBusy(true); setError('')

    const username = displayName.toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!username) { setError('Name must contain letters or numbers'); setBusy(false); return }

    // Reuse existing user if the username already exists
    const { data: existing } = await supabase.from('users').select('*').eq('username', username).maybeSingle()
    if (existing) {
      onCreated(existing)
      return
    }

    const { data, error: err } = await supabase
      .from('users')
      .insert({ username, name: displayName })
      .select()
      .single()

    if (err) { setError(err.message); setBusy(false); return }
    onCreated(data)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onMouseDown={onClose}>
      <form
        onSubmit={create}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-tg-sidebar rounded-xl p-6 space-y-4 shadow-2xl"
      >
        <h2 className="text-lg font-semibold">New Message</h2>
        <p className="text-sm text-gray-400 -mt-2">Enter the person's name. If they already have an account, their chat opens; otherwise a new user is created.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Bob)"
          className="w-full bg-tg-input rounded-lg px-4 py-3 outline-none border border-transparent focus:border-tg-accent"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-[#3390ec] hover:bg-[#2f86dd] disabled:opacity-60 text-sm font-medium">
            {busy ? 'Creating…' : 'Start chat'}
          </button>
        </div>
      </form>
    </div>
  )
}
