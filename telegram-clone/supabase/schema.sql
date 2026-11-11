-- ============================================================
-- TELEGRAM CLONE — Supabase schema. Run this ONCE in the
-- Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================

-- Users table (simple username auth, no Supabase Auth needed)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- Messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists messages_created_at_idx on public.messages (created_at);
create index if not exists messages_sender_idx on public.messages (sender_id);
create index if not exists messages_receiver_idx on public.messages (receiver_id);

-- Row Level Security (demo-friendly: allow anon access)
alter table public.users disable row level security;
alter table public.messages disable row level security;

-- Grant access
grant all on public.users to anon, authenticated;
grant all on public.messages to anon, authenticated;

-- Enable realtime on messages (also enable in Dashboard:
-- Database -> Replication -> messages -> toggle ON)
alter publication supabase_realtime add table public.messages;
