# Telegram Clone — Setup Guide

Backend: **Supabase** (free tier, built-in realtime, zero server code).

## 1. Create the Supabase project

1. Go to https://supabase.com → **Sign in** → **New project**
2. Name it `telegram-clone`, pick any database password, region close to you.
3. Wait ~2 minutes for it to provision.

## 2. Run the SQL schema

1. In the project dashboard open **SQL Editor** → **New query**
2. Paste the entire contents of `telegram-clone/supabase/schema.sql`
3. Click **Run** (bottom right). You should see "Success. No rows returned".
4. Then also go to **Database → Replication** and confirm `messages` and `users`
   are toggled ON under "supabase_realtime" (the SQL usually enables `messages` already).

## 3. Get your API keys

Go to **Project Settings → API**. You need:
- **Project URL** → this is `VITE_SUPABASE_URL`
- **anon public key** → this is `VITE_SUPABASE_ANON_KEY`

## 4. Create the .env

`telegram-clone/.env` (already created, just paste your real values):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your_long_anon_key
```

## 5. Install & run

```powershell
cd d:\Krynara-OS\telegram-clone
npm install
npm run dev
```

Open http://localhost:5174

---

# Test checklist (2 users, real realtime)

1. **Window A** (normal Chrome): open `http://localhost:5174` → sign in as `alice`
2. **Window B** (Incognito — separate localStorage!): open same URL → sign in as `bob`
3. In **A**: click ✏️ pencil (bottom left) → type "Bob" → **Start chat** → Bob appears in A's sidebar
4. In **B**: Alice appears automatically after clicking in the window / refocusing (focus re-fetch). Bob selects Alice.
5. A sends "hello 👋" → appears instantly in B **without refresh**
6. B replies → appears instantly in A
7. **Ticks**: when A sends, she first sees one grey tick (sent) → it becomes a double tick (delivered, B's client received & marked read) → blue double tick once B has the chat open
8. **Unread badge**: if B is in a *different* chat, messages from A increment B's red badge on Alice's row
9. **Typing indicator**: hold typing in A → B's header shows "typing…"
10. **Date separators**: they appear above message groups ("Today" etc.)
11. **Persistence**: press F5 on both windows — history is loaded from Supabase
12. **Verify DB**: Supabase → Table Editor → `messages` — every message row has `sender_id`, `receiver_id`, `text`, `created_at`

## Mobile check
Resize the browser to phone width (or open on your phone on the same Wi-Fi via your PC's LAN IP, e.g. `http://192.168.x.x:5174`). Sidebar and chat swap full-screen with a back arrow in the chat header.

## Troubleshooting
- **"Supabase not configured" screen** → `.env` values missing or contain the placeholder text; restart `npm run dev` after editing.
- **Messages don't arrive live** → Database → Replication → make sure `messages` is ON for realtime.
- **Relation error** → schema.sql wasn't run; re-run it.
