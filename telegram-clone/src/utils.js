// Shared helpers

export const AVATAR_COLORS = [
  '#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae',
  '#faa774', '#6ec9cb', '#faa774', '#ecae5c',
]

export function colorFor(id) {
  let n = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) n = (n + s.charCodeAt(i) * 31) % 9973
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

export function initialsOf(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || parts[0][0].toUpperCase()
}

export function timeHM(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// "12:30", "Yesterday", weekday or date — for chat list / separators
export function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yest)) return 'Yesterday'
  const diffDays = Math.floor((today - d) / 86400000)
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function chatListTime(iso) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return timeHM(iso)
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😐',
  '😴', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🔥', '❤️',
  '💔', '🎉', '😎', '🚀', '⭐', '🍕', '☕', '⚽', '🎮', '✅',
]
