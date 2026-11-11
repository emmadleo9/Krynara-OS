import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseReady = Boolean(url && anonKey && !url.includes('YOUR_PROJECT_ID'))

export const supabase = createClient(
  supabaseReady ? url : 'https://placeholder.supabase.co',
  supabaseReady ? anonKey : 'placeholder-anon-key',
  {
    realtime: { params: { eventsPerSecond: 20 } },
  },
)
