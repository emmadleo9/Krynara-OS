import { useCallback, useEffect, useRef, useState } from 'react';
import { HudFrame } from '@/components/hud';
import { SwarmSettingsPanel } from '@/features/swarm/SwarmSettingsPanel';
import {
  exportAllKrynaraMemory,
  getKrynaraStorageStatus,
  importKrynaraMemory,
  initKrynaraStorage,
  selectKrynaraDataDirectory,
  testKrynaraPersistence,
} from '@/services/persistentStorage';
import { checkLimit } from '@/services/quotaManager';
import { TelegramSettings } from './TelegramSettings';
import { DebugPanel } from './DebugPanel';

type KeyEntry = { id: string; label: string; url: string; scope: string; connected: boolean; masked: string };

type RealStorageStats = {
  osFolder: { path: string; bytes: number; gb: string };
  dataFolder: { path: string; bytes: number; gb: string };
  krynaraTotal: { bytes: number; gb: string };
  drive: {
    mount: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    totalGb: string;
    usedGb: string;
    freeGb: string;
    usedPercent: number;
  };
  measuredAt: string;
};

export function SettingsView() {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [storageStatus, setStorageStatus] = useState(() => getKrynaraStorageStatus());
  const [quotaText, setQuotaText] = useState('Checking storage usage…');
  const [storageBusy, setStorageBusy] = useState(false);
  const [realStorage, setRealStorage] = useState<RealStorageStats | null>(null);
  const [idbUsage, setIdbUsage] = useState<{ usedMb: string; quotaGb: string } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const loadRealStorage = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/real-stats');
      if (res.ok) {
        const data = await res.json() as RealStorageStats;
        setRealStorage(data);
      }
    } catch {
      // ignore
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMb = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
        const quotaGb = ((est.quota || 0) / (1024 ** 3)).toFixed(1);
        setIdbUsage({ usedMb, quotaGb });
      } catch {}
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/keys');
      const data = await response.json() as { keys?: KeyEntry[] };
      setKeys(data.keys ?? []);
    } catch {
      setMessage('Gateway unreachable — start the local gateway first.');
    }
  }, []);

  useEffect(() => { void load(); void loadRealStorage(); }, [load, loadRealStorage]);
  useEffect(() => {
    void initKrynaraStorage()
      .then((status) => {
        setStorageStatus(status);
        return checkLimit();
      })
      .then((quota) => setQuotaText(quota.text))
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const connect = async (id: string) => {
    const value = drafts[id]?.trim();
    if (!value) {
      setMessage(`Paste YOUR ${id} key first — open the provider link, sign in with your account, copy the key.`);
      return;
    }
    setBusy(id);
    try {
      const response = await fetch(`/api/keys/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDrafts((current) => ({ ...current, [id]: '' }));
      setMessage(`${id} connected — stored on Disk D (config/keys.json), never committed.`);
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
    setMessage(`${id} removed.`);
  };

  const selectDataFolder = async () => {
    setStorageBusy(true);
    try {
      const status = await selectKrynaraDataDirectory();
      setStorageStatus(status);
      setQuotaText((await checkLimit()).text);
      setMessage(status.directoryStatus);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStorageBusy(false);
    }
  };

  const exportMemory = async () => {
    setStorageBusy(true);
    try {
      const data = await exportAllKrynaraMemory();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `krynara-memory-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('All KRYNARA memory exported as JSON.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStorageBusy(false);
    }
  };

  const importMemory = async (file?: File) => {
    if (!file) return;
    setStorageBusy(true);
    try {
      const data: unknown = JSON.parse(await file.text());
      await importKrynaraMemory(data);
      setQuotaText((await checkLimit()).text);
      setMessage(`Imported ${file.name}.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStorageBusy(false);
      if (importInput.current) importInput.current.value = '';
    }
  };

  const testPersistence = async () => {
    setStorageBusy(true);
    try {
      const result = await testKrynaraPersistence();
      setQuotaText((await checkLimit()).text);
      setMessage(`Persistence test passed at ${result.at}.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStorageBusy(false);
    }
  };

  return (
    <div className="settings-stack">
      <DebugPanel />

      <SwarmSettingsPanel />

      <TelegramSettings />

      <HudFrame title="MY ACCOUNTS // API CONNECTIONS">
        <p className="credential-notice">
          Every API in KRYNARA runs on YOUR accounts — no fake keys, no demo accounts. Sign in at each provider with your own login, generate a key, paste it below.{' '}Keys persist to <strong>{'<KRYNARA_STORAGE_ROOT>'}\config\keys.json</strong> and never leave this machine.{' '}
          Telegram keys? <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="hud-link">HOW TO GET KEYS →</a> (my.telegram.org → API development tools → Create app → copy api_id + api_hash).
        </p>
        <div className="settings-key-grid">
          {keys.map((entry) => (
            <div className="settings-key" key={entry.id}>
              <div className="settings-key-head">
                <strong>{entry.label}</strong>
                <span className={`status-dot${entry.connected ? '' : ' status-dot-offline'}`} />
                <small>{entry.connected ? 'CONNECTED' : 'NOT CONNECTED'}</small>
              </div>
              <small className="settings-key-scope">{entry.scope} · <a href={entry.url} target="_blank" rel="noreferrer" className="hud-link">LOGIN TO GET KEY →</a></small>
              <div className="settings-key-row">
                <input
                  aria-label={`${entry.label} API key`}
                  type="password"
                  autoComplete="off"
                  value={drafts[entry.id] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                  placeholder={entry.connected ? entry.masked : 'Paste your key…'}
                />
                <button type="button" className="hud-button" onClick={() => void connect(entry.id)} disabled={busy === entry.id}>
                  {busy === entry.id ? 'SAVING…' : 'CONNECT WITH MY ACCOUNT'}
                </button>
                {entry.connected && <button type="button" className="hud-button" onClick={() => void disconnect(entry.id)}>REMOVE</button>}
              </div>
            </div>
          ))}
          {keys.length === 0 && <p className="inline-status">Loading key registry from gateway…</p>}
        </div>
        {message && <p className="inline-status">{message}</p>}
      </HudFrame>

      <HudFrame title="REQUIRED FOR FULL POWER">
        <div className="settings-required">
          <div><strong>NVIDIA NIM</strong> — chat (Llama 405B), image (Flux.1, SD 3.5), vision (Llama 3.2), unlocks AI Studio NEXUS mode.</div>
          <div><strong>Cesium ion</strong> — 3D terrain, satellite and buildings tiles for World View.</div>
          <div><strong>OpenWeatherMap</strong> — thermal, wind, precipitation overlay layers in Weather Intel.</div>
          <div><strong>ElevenLabs</strong> — premium British TTS voice for NOVA.</div>
          <div><strong>OpenSky</strong> — authenticated live plane telemetry (higher rate limits).</div>
        </div>
      </HudFrame>

      <HudFrame title="KRYNARA STORAGE // LITERAL DISK & SYSTEM USAGE">
        <p className="credential-notice">
          Real filesystem metrics computed directly from disk. Shows literal size of both Krynara folders and total capacity of Drive {realStorage?.drive?.mount || 'D:'}.
        </p>
        <div className="storage-status-grid">
          <div className="settings-key-head">
            <span className={`status-dot${storageStatus.directorySelected ? '' : ' status-dot-offline'}`} />
            <strong>DISK {realStorage?.drive?.mount || 'D:'}: {realStorage?.drive?.usedGb || '--'} GB USED OF {realStorage?.drive?.totalGb || '--'} GB ({realStorage?.drive?.usedPercent ?? 0}%)</strong>
          </div>
          <div id="quota-bar" className="quota-bar" role="progressbar" aria-valuenow={realStorage?.drive?.usedPercent ?? 0} aria-valuemin={0} aria-valuemax={100}>
            {realStorage ? `Drive ${realStorage.drive.mount} Free: ${realStorage.drive.freeGb} GB | Krynara Total: ${realStorage.krynaraTotal.gb} GB` : quotaText}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '12px' }}>
            <div style={{ padding: '10px', border: '1px solid rgba(138,248,255,0.2)', background: 'rgba(5,10,14,0.6)' }}>
              <div style={{ color: 'var(--krynara-cyan)', fontSize: '11px', fontWeight: 'bold' }}>OS FOLDER</div>
              <div style={{ fontSize: '14px', marginTop: '4px' }}>{realStorage?.osFolder.gb || '--'} GB</div>
              <small style={{ color: 'var(--krynara-muted)', fontSize: '9px' }}>{realStorage?.osFolder.path || 'D:\\Krynara-OS'}</small>
            </div>
            <div style={{ padding: '10px', border: '1px solid rgba(138,248,255,0.2)', background: 'rgba(5,10,14,0.6)' }}>
              <div style={{ color: 'var(--krynara-cyan)', fontSize: '11px', fontWeight: 'bold' }}>DATA STORAGE FOLDER</div>
              <div style={{ fontSize: '14px', marginTop: '4px' }}>{realStorage?.dataFolder.gb || '--'} GB</div>
              <small style={{ color: 'var(--krynara-muted)', fontSize: '9px' }}>{realStorage?.dataFolder.path || 'D:\\Krynara-OS-STORAGE'}</small>
            </div>
            <div style={{ padding: '10px', border: '1px solid rgba(138,248,255,0.2)', background: 'rgba(5,10,14,0.6)' }}>
              <div style={{ color: 'var(--krynara-cyan)', fontSize: '11px', fontWeight: 'bold' }}>INDEXEDDB STORAGE</div>
              <div style={{ fontSize: '14px', marginTop: '4px' }}>{idbUsage ? `${idbUsage.usedMb} MB` : 'Estimating…'}</div>
              <small style={{ color: 'var(--krynara-muted)', fontSize: '9px' }}>Quota: {idbUsage?.quotaGb || '--'} GB</small>
            </div>
          </div>

          <div className="storage-actions" style={{ marginTop: '14px' }}>
            <button type="button" className="hud-button" disabled={storageBusy} onClick={() => void selectDataFolder()}>
              SYNC / SELECT DATA FOLDER
            </button>
            <button type="button" className="hud-button" disabled={storageBusy} onClick={() => void exportMemory()}>
              EXPORT ALL MEMORY JSON
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              aria-label="Import KRYNARA memory JSON"
              hidden
              onChange={(event) => void importMemory(event.target.files?.[0])}
            />
            <button type="button" className="hud-button" disabled={storageBusy} onClick={() => importInput.current?.click()}>
              IMPORT MEMORY
            </button>
            <button type="button" className="hud-button" disabled={storageBusy} onClick={() => void testPersistence()}>
              TEST PERSISTENCE
            </button>
          </div>
          {message && <p className="inline-status" role="status">{message}</p>}
        </div>
      </HudFrame>
    </div>
  );
}
