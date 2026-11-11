import { useEffect, useState } from 'react';
import { HudFrame } from '@/components/hud';
import { readSavedAccount } from '@/features/social/TelegramLive';

/**
 * DEBUG panel — shows REAL runtime facts, never a fake "Connected":
 * - Supabase URL (masked) + whether the anon key is present
 * - Whether the Supabase REST endpoint actually answers (not just "keys exist")
 * - The saved Telegram account (from localStorage, written on successful login)
 * - The last real error from the gateway / bridge / Supabase
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

function maskUrl(url: string): string {
  if (!url) return '(missing)';
  try {
    const parsed = new URL(url);
    // keep host, hide nothing else meaningful — this is a public URL anyway,
    // but mask the project ref to keep console output clean.
    return parsed.host.replace(/^[a-z0-9]{4}/i, '****');
  } catch {
    return '(invalid url)';
  }
}

function maskKey(key: string): string {
  if (!key) return 'MISSING';
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function DebugPanel() {
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'ok' | 'fail' | 'missing'>('checking');
  const [supabaseDetail, setSupabaseDetail] = useState('');
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'ok' | 'fail'>('checking');
  const [lastError, setLastError] = useState('');

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
        if (alive) { setSupabaseStatus('missing'); setSupabaseDetail('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set in console/.env — restart `npm run dev` after editing.'); }
        return;
      }
      try {
        const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        });
        if (alive) { setSupabaseStatus(res.ok ? 'ok' : 'fail'); setSupabaseDetail(res.ok ? 'REST endpoint answered.' : `HTTP ${res.status}`); }
      } catch (err) {
        if (alive) { setSupabaseStatus('fail'); setSupabaseDetail(err instanceof Error ? err.message : String(err)); }
      }
      try {
        const gw = await fetch('/api/health');
        if (alive) setGatewayStatus(gw.ok ? 'ok' : 'fail');
      } catch {
        if (alive) setGatewayStatus('fail');
      }
    };
    void run();
    const timer = window.setInterval(run, 30000);
    const onError = (event: ErrorEvent) => { if (alive) setLastError(event.message); };
    window.addEventListener('error', onError);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('error', onError); };
  }, []);

  const account = readSavedAccount();
  const dot = supabaseStatus === 'ok' && gatewayStatus === 'ok' ? '' : 'status-dot-offline';

  return (
    <HudFrame title="DEBUG // CONNECTION TRUTH">
      <div className="storage-status-grid">
        <div className="settings-key-head">
          <span className={`status-dot${dot ? ' status-dot-offline' : ''}`} />
          <strong>SUPABASE URL</strong>
          <small>{maskUrl(SUPABASE_URL)}</small>
        </div>
        <div className="settings-key-head">
          <span className={`status-dot${SUPABASE_KEY ? '' : ' status-dot-offline'}`} />
          <strong>KEY STATUS</strong>
          <small>{SUPABASE_KEY ? `OK (${maskKey(SUPABASE_KEY)})` : 'Missing'}</small>
        </div>
        <div className="settings-key-head">
          <span className={`status-dot${supabaseStatus === 'ok' ? '' : ' status-dot-offline'}`} />
          <strong>SUPABASE REACHABLE</strong>
          <small>{supabaseStatus === 'checking' ? 'CHECKING…' : supabaseStatus.toUpperCase()} {supabaseDetail}</small>
        </div>
        <div className="settings-key-head">
          <span className={`status-dot${gatewayStatus === 'ok' ? '' : ' status-dot-offline'}`} />
          <strong>GATEWAY (2785)</strong>
          <small>{gatewayStatus === 'checking' ? 'CHECKING…' : gatewayStatus === 'ok' ? 'ONLINE' : 'OFFLINE — start the gateway'}</small>
        </div>
        <div className="settings-key-head">
          <span className={`status-dot${account ? '' : ' status-dot-offline'}`} />
          <strong>SELECTED ACCOUNT</strong>
          <small>{account ? `${account.name}${account.username ? ` (@${account.username})` : ''}` : 'None'}</small>
        </div>
        <div className="settings-key-head">
          <span className="status-dot status-dot-offline" />
          <strong>LAST ERROR</strong>
          <small>{lastError || 'None'}</small>
        </div>
      </div>
      <p className="credential-notice">
        Source of truth: <code>D:\Krynara-OS-STORAGE\config\keys.json</code> (via gateway /api/keys) +{' '}
        <code>console/.env</code> for VITE_SUPABASE_*. If a key was just changed, restart <code>npm run dev</code>.
      </p>
    </HudFrame>
  );
}
