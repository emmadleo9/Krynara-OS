import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GaugeCircle, HudFrame, StatusCard } from '@/components/hud';

type CheckStatus = 'checking' | 'online' | 'offline' | 'unconfigured';
type ApiCheck = { name: string; url?: string; tokenKey?: string; userIdKey?: string; statusField?: string; availabilityField?: string; expectedFeed?: string; status: CheckStatus; latency: number | null; lastChecked: string; detail: string };
type CpuPoint = { time: string; cpu: number | null; memory: number | null; disk: number | null };
type SystemStats = { cpuLoad: number; memoryLoad: number; memoryUsedGb: number; memoryTotalGb: number; diskLoad: number; diskUsedGb: number; diskTotalGb: number };

const checks: Array<Pick<ApiCheck, 'name' | 'url' | 'tokenKey' | 'userIdKey' | 'statusField' | 'availabilityField' | 'expectedFeed'>> = [
  { name: 'GATEWAY', url: '/api/health' },
  { name: 'ADS-B', url: '/api/feeds/adsb' },
  { name: 'USGS', url: '/api/feeds/usgs' },
  { name: 'GDELT', url: '/api/feeds/gdelt' },
  { name: 'GDELT SEARCH', url: '/api/gdelt/search?q=earthquake' },
  { name: 'SATELLITE TRACKING', url: '/api/satellites' },
  { name: 'OPEN-METEO WEATHER', url: '/api/weather?latitude=33.68&longitude=73.04' },
  { name: 'OPEN-METEO GEOCODING', url: '/api/geocode?q=Islamabad' },
  { name: 'OPEN-METEO WIND', url: '/api/feeds/wind?bbox=72.95,33.60,73.12,33.75' },
  { name: 'NASA EONET FIRES', url: '/api/feeds/fires' },
  { name: 'NOAA WEATHER ALERTS', url: '/api/feeds/weather-alerts' },
  { name: 'NOAA SATELLITE WMS', url: 'https://nowcoast.noaa.gov/geoserver/observations/satellite/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=global_longwave_imagery_mosaic&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&BBOX=-8239000,4970000,-8220000,4990000&WIDTH=256&HEIGHT=256' },
  { name: 'RAINVIEWER RADAR', url: '/api/feeds/rain-radar' },
  { name: 'OSRM DIRECTIONS', url: '/api/feeds/directions?from=-73.9857,40.7484&to=-73.9851,40.7580' },
  { name: 'MTA NEW YORK TRANSIT', url: '/api/feeds/transit?bbox=-74.01,40.70,-73.99,40.72', expectedFeed: 'MTA New York City buses' },
  { name: 'SEPTA PHILADELPHIA', url: '/api/feeds/transit?bbox=-75.18,39.93,-75.14,39.97', expectedFeed: 'SEPTA Philadelphia' },
  { name: 'ENTUR NORWAY', url: '/api/feeds/transit?bbox=10.65,59.85,10.90,59.98', expectedFeed: 'Entur Norway' },
  { name: 'HSL HELSINKI', url: '/api/feeds/transit?bbox=24.90,60.15,25.15,60.30', expectedFeed: 'HSL Helsinki region' },
  { name: 'SOFIA TRANSIT', url: '/api/feeds/transit?bbox=23.30,42.60,23.40,42.75', expectedFeed: 'Sofia Traffic' },
  { name: 'ROME TRANSIT', url: '/api/feeds/transit?bbox=12.45,41.85,12.55,41.95', expectedFeed: 'Roma Mobilità' },
  { name: 'LVIV TRANSIT', url: '/api/feeds/transit?bbox=23.95,49.80,24.05,49.90', expectedFeed: 'Lvivavtodor' },
  { name: 'BUCHAREST TRANSIT', url: '/api/feeds/transit?bbox=26.00,44.40,26.15,44.50', expectedFeed: 'Bucharest TPBI' },
  { name: 'TRANSLINK QUEENSLAND', url: '/api/feeds/transit?bbox=153.00,-27.60,153.15,-27.45', expectedFeed: 'TransLink Queensland' },
  { name: 'ADELAIDE METRO', url: '/api/feeds/transit?bbox=138.55,-34.95,138.65,-34.85', expectedFeed: 'Adelaide Metro' },
  { name: 'CARTO BASEMAP', url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  { name: 'ESRI SATELLITE TILES', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/1' },
  { name: 'AWS TERRAIN TILES', url: 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/2/1/1.png' },
  { name: 'LOCAL AI / OLLAMA', url: '/api/nova/models', availabilityField: 'available' },
  { name: 'TELEGRAM', url: '/api/telegram/status', statusField: 'authorized' },
  { name: 'DISCORD', tokenKey: 'discord_bot_token' },
  { name: 'KRYNARA WHATSAPP', url: '/api/whatsapp/status', statusField: 'status' },
  { name: 'INSTAGRAM', tokenKey: 'instagram_token', userIdKey: 'instagram_user_id' },
];

function initialChecks(): ApiCheck[] {
  return checks.map((check) => ({ ...check, status: 'checking', latency: null, lastChecked: 'WAITING', detail: 'CHECK PENDING' }));
}

function formatCheckTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type CheckConfig = Pick<ApiCheck, 'name' | 'url' | 'tokenKey' | 'userIdKey' | 'statusField' | 'availabilityField' | 'expectedFeed'>;

const CHECK_CONCURRENCY = 4;

async function checkApi(check: CheckConfig): Promise<ApiCheck> {
  const start = performance.now();
  const checkedAt = formatCheckTime();
  if (check.tokenKey) {
    const token = localStorage.getItem(check.tokenKey);
    const userId = check.userIdKey ? localStorage.getItem(check.userIdKey) : '';
    if (!token || (check.userIdKey && !userId)) {
      return { ...check, status: 'unconfigured', latency: null, lastChecked: checkedAt, detail: 'ADD USER-OWNED CREDENTIALS IN SOCIAL HUB' };
    }

    let url = '';
    const headers = new Headers();
    if (check.name === 'TELEGRAM') {
      url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`;
    } else if (check.name === 'DISCORD') {
      url = 'https://discord.com/api/v10/users/@me';
      headers.set('Authorization', `Bot ${token}`);
    } else if (check.name === 'WHATSAPP') {
      url = `https://graph.facebook.com/v23.0/${encodeURIComponent(userId!)}?fields=id`;
      headers.set('Authorization', `Bearer ${token}`);
    } else {
      url = `https://graph.facebook.com/v23.0/${encodeURIComponent(userId!)}?fields=id,username`;
      headers.set('Authorization', `Bearer ${token}`);
    }
    return performCheck(check, url, headers, start, checkedAt);
  }
  return performCheck(check, check.url!, new Headers(), start, checkedAt);
}

async function performCheck(check: CheckConfig, url: string, headers: Headers, start: number, checkedAt: string): Promise<ApiCheck> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    const latency = Math.round(performance.now() - start);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json().catch(() => null) as ({ [key: string]: unknown; ok?: boolean; error?: { message?: string } } | null);
    if (check.availabilityField && body?.[check.availabilityField] === false) {
      throw new Error('SERVICE UNAVAILABLE');
    }
    if (body?.ok === false) throw new Error(body.error?.message || 'API rejected the check.');
    if (check.expectedFeed) {
      const feeds = body?.feeds as Array<{ feed?: string; count?: number; error?: string }> | undefined;
      const feed = feeds?.find((item) => item.feed === check.expectedFeed);
      if (!feed) throw new Error('FEED NOT AVAILABLE IN THIS REGION');
      if (feed.error) throw new Error(feed.error);
      return { ...check, status: 'online', latency, lastChecked: checkedAt, detail: `FEED RESPONDED · ${feed.count ?? 0} VEHICLES` };
    }
    if (check.statusField) {
      const value = body?.[check.statusField];
      const ok = value === 'online' || value === true;
      if (!ok) {
        return { ...check, status: 'offline', latency, lastChecked: checkedAt, detail: typeof value === 'string' ? `SESSION ${value.toUpperCase()}` : 'SESSION NOT READY' };
      }
      const user = (body as { user?: { username?: string } } | undefined)?.user;
      return { ...check, status: 'online', latency, lastChecked: checkedAt, detail: user?.username ? `LOGGED IN AS @${String(user.username).toUpperCase()}` : 'SESSION READY' };
    }
    return { ...check, status: 'online', latency, lastChecked: checkedAt, detail: 'ENDPOINT RESPONDED' };
  } catch (reason) {
    return {
      ...check,
      status: 'offline',
      latency: Math.round(performance.now() - start),
      lastChecked: checkedAt,
      detail: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

export function DiagnosticsView() {
  const [apiChecks, setApiChecks] = useState<ApiCheck[]>(initialChecks);
  const [cpuHistory, setCpuHistory] = useState<CpuPoint[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [gatewayMessage, setGatewayMessage] = useState('');
  const [now, setNow] = useState(() => new Date());
  const logPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let checking = false;
    const runChecks = async () => {
      if (checking) return;
      checking = true;
      let nextCheck = 0;
      const worker = async () => {
        while (nextCheck < checks.length) {
          const index = nextCheck++;
          const result = await checkApi(checks[index]!);
          if (active) {
            setApiChecks((current) => {
              const updated = [...current];
              updated[index] = result;
              return updated;
            });
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, checks.length) }, worker));
      } finally {
        checking = false;
      }
    };
    void runChecks();
    const timer = window.setInterval(() => void runChecks(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    let loadingStats = false;
    let loadingLogs = false;
    const loadSystemStats = async () => {
      if (loadingStats) return;
      loadingStats = true;
      try {
        const response = await fetch('/api/system-stats', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
        const result = await response.json() as SystemStats;
        if (active) {
          setSystemStats(result);
          setCpuHistory((current) => [...current.slice(-39), {
            time: formatCheckTime(),
            cpu: result.cpuLoad,
            memory: result.memoryLoad,
            disk: result.diskLoad,
          }]);
        }
      } catch {
        if (active) setCpuHistory((current) => [...current.slice(-39), { time: formatCheckTime(), cpu: null, memory: null, disk: null }]);
      } finally {
        loadingStats = false;
      }
    };

    const loadLogs = async () => {
      if (loadingLogs) return;
      loadingLogs = true;
      try {
        const response = await fetch('/api/logs', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Gateway logs returned HTTP ${response.status}`);
        const result = await response.json() as { logs?: string[] };
        if (active) setLogs(result.logs ?? []);
      } catch (reason) {
        if (active) setLogs([`[${formatCheckTime()}] LOG VIEWER ERROR: ${reason instanceof Error ? reason.message : String(reason)}`]);
      } finally {
        loadingLogs = false;
      }
    };

    const updateTime = () => setNow(new Date());
    void loadSystemStats();
    void loadLogs();
    const statsTimer = window.setInterval(() => void loadSystemStats(), 2000);
    const logsTimer = window.setInterval(() => void loadLogs(), 5000);
    const clockTimer = window.setInterval(updateTime, 1000);
    return () => {
      active = false;
      window.clearInterval(statsTimer);
      window.clearInterval(logsTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    const pane = logPaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [logs]);

  const restartGateway = async () => {
    setGatewayMessage('REQUESTING GATEWAY RESTART…');
    try {
      const response = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`Restart request returned HTTP ${response.status}`);
      const result = await response.json() as { message?: string };
      setGatewayMessage(result.message ?? 'Gateway restart requested.');
    } catch (reason) {
      setGatewayMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const onlineCount = apiChecks.filter((check) => check.status === 'online').length;
  const measuredLatency = apiChecks.filter((check) => check.latency !== null).map((check) => check.latency!);
  const averageLatency = measuredLatency.length ? Math.round(measuredLatency.reduce((sum, latency) => sum + latency, 0) / measuredLatency.length) : null;

  return (
    <div className="diagnostics-page">
      <div className="krynara-grid krynara-grid-3">
        <StatusCard label="API SERVICES ONLINE" value={`${onlineCount} / ${apiChecks.length}`} sub="LIVE PUBLIC ENDPOINT CHECKS" status={onlineCount ? 'online' : 'warning'} />
        <StatusCard label="MEAN API LATENCY" value={averageLatency === null ? '--' : `${averageLatency}ms`} sub="SUCCESSFUL + FAILED CHECKS" status={averageLatency === null ? 'warning' : averageLatency > 500 ? 'offline' : averageLatency > 200 ? 'warning' : 'online'} />
        <StatusCard label="LAST CHECK" value={new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)} sub="API CHECK 60S // HOST SAMPLE 2S" />
      </div>

      <div className="diagnostics-layout">
        <HudFrame title="API CONNECTIVITY // LIVE" className="diagnostics-services">
          <div className="diagnostics-check-list">
            {apiChecks.map((check) => (
              <div className="diagnostics-check" key={check.name}>
                <span className={`diagnostics-indicator ${check.status}`}><span className="status-dot" /></span>
                <strong>{check.name}</strong>
                <span className="diagnostics-detail">{check.detail}</span>
                <span className="diagnostics-latency" style={{ color: check.latency === null ? undefined : check.latency < 200 ? 'var(--krynara-green)' : check.latency <= 500 ? 'var(--krynara-amber)' : 'var(--krynara-red)' }}>{check.latency === null ? '—' : `${check.latency} ms`}</span>
                <time>{check.lastChecked}</time>
              </div>
            ))}
          </div>
        </HudFrame>

        <div className="diagnostics-side">
          <HudFrame title="HOST LOAD // LAST 40 SAMPLES" className="diagnostics-chart-panel">
            <div className="diagnostics-host-summary">
              <GaugeCircle label="CPU LOAD" value={systemStats ? `${systemStats.cpuLoad.toFixed(0)}%` : '--'} sub="LIVE" percent={systemStats?.cpuLoad ?? 0} size={132} />
              <div className="diagnostics-host-values">
                <div><span>CPU</span><strong>{systemStats ? `${systemStats.cpuLoad.toFixed(1)}%` : '—'}</strong></div>
                <div><span>MEMORY</span><strong>{systemStats ? `${systemStats.memoryUsedGb.toFixed(1)} / ${systemStats.memoryTotalGb.toFixed(1)} GB` : '—'}</strong></div>
                <div><span>DISK</span><strong>{systemStats ? `${systemStats.diskUsedGb.toFixed(1)} / ${systemStats.diskTotalGb.toFixed(1)} GB` : '—'}</strong></div>
              </div>
            </div>
            {cpuHistory.length ? (
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 220 }}>
                <AreaChart data={cpuHistory} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8AF8FF" stopOpacity={0.28} /><stop offset="95%" stopColor="#8AF8FF" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(138,248,255,.12)" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: '#9ab8bd', fontSize: 9 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#9ab8bd', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#07151b', border: '1px solid #8AF8FF', color: '#E6FBFF' }} />
                  <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#8AF8FF" fill="url(#cpuFill)" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="memory" name="MEM %" stroke="#FFD700" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="disk" name="DISK %" stroke="#00FF88" strokeWidth={1.5} dot={false} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="diagnostics-empty">WAITING FOR HOST METRICS</div>}
          </HudFrame>
          <HudFrame title="GATEWAY LOGS" className="diagnostics-logs">
            <div className="log-viewer" ref={logPaneRef} role="log" aria-live="polite">
              {logs.length ? logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <div>Waiting for gateway logs…</div>}
            </div>
            <div className="gateway-restart">
              <button type="button" className="hud-button" onClick={() => void restartGateway()}>RESTART GATEWAY</button>
              {gatewayMessage && <span role="status">{gatewayMessage}</span>}
            </div>
          </HudFrame>
        </div>
      </div>
      <p className="diagnostics-note">SOCIAL API CHECKS USE ONLY TOKENS YOU CONFIGURE IN THIS BROWSER. NO SCRAPING OR THIRD-PARTY TOKEN RELAYS.</p>
    </div>
  );
}
