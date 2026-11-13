import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GaugeCircle, HudFrame, StatusCard } from "@/components/hud";

type CheckStatus =
  | "idle"
  | "checking"
  | "online"
  | "offline"
  | "timeout"
  | "unconfigured";
type Section = "core" | "data" | "transit" | "social" | "tiles";

type CheckConfig = {
  name: string;
  section: Section;
  url?: string;
  tokenKey?: string;
  userIdKey?: string;
  statusField?: string;
  availabilityField?: string;
  expectedFeed?: string;
};

type ApiCheck = CheckConfig & {
  status: CheckStatus;
  latency: number | null;
  lastChecked: string;
  checkedAtMs: number | null;
  detail: string;
};

type CpuPoint = {
  time: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
};
type SystemStats = {
  cpuLoad: number;
  memoryLoad: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  diskLoad: number;
  diskUsedGb: number;
  diskTotalGb: number;
};

const SECTIONS: Array<{ id: Section | "all"; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "core", label: "CORE" },
  { id: "data", label: "PUBLIC DATA" },
  { id: "transit", label: "TRANSIT" },
  { id: "social", label: "SOCIAL" },
  { id: "tiles", label: "TILES" },
];

const checks: CheckConfig[] = [
  { name: "GATEWAY", section: "core", url: "/api/health" },
  { name: "ADS-B", section: "data", url: "/api/feeds/adsb" },
  { name: "USGS", section: "data", url: "/api/feeds/usgs" },
  { name: "GDELT", section: "data", url: "/api/feeds/gdelt" },
  {
    name: "GDELT SEARCH",
    section: "data",
    url: "/api/gdelt/search?q=earthquake",
  },
  { name: "SATELLITE TRACKING", section: "data", url: "/api/satellites" },
  {
    name: "OPEN-METEO WEATHER",
    section: "data",
    url: "/api/weather?latitude=33.68&longitude=73.04",
  },
  {
    name: "OPEN-METEO GEOCODING",
    section: "data",
    url: "/api/geocode?q=Islamabad",
  },
  {
    name: "OPEN-METEO WIND",
    section: "data",
    url: "/api/feeds/wind?bbox=72.95,33.60,73.12,33.75",
  },
  { name: "NASA EONET FIRES", section: "data", url: "/api/feeds/fires" },
  {
    name: "NOAA WEATHER ALERTS",
    section: "data",
    url: "/api/feeds/weather-alerts",
  },
  {
    name: "NOAA SATELLITE WMS",
    section: "data",
    url: "https://nowcoast.noaa.gov/geoserver/observations/satellite/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=global_longwave_imagery_mosaic&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&BBOX=-8239000,4970000,-8220000,4990000&WIDTH=256&HEIGHT=256",
  },
  { name: "RAINVIEWER RADAR", section: "data", url: "/api/feeds/rain-radar" },
  {
    name: "OSRM DIRECTIONS",
    section: "transit",
    url: "/api/feeds/directions?from=-73.9857,40.7484&to=-73.9851,40.7580",
  },
  {
    name: "MTA NEW YORK TRANSIT",
    section: "transit",
    url: "/api/feeds/transit?bbox=-74.01,40.70,-73.99,40.72",
    expectedFeed: "MTA New York City buses",
  },
  {
    name: "SEPTA PHILADELPHIA",
    section: "transit",
    url: "/api/feeds/transit?bbox=-75.18,39.93,-75.14,39.97",
    expectedFeed: "SEPTA Philadelphia",
  },
  {
    name: "ENTUR NORWAY",
    section: "transit",
    url: "/api/feeds/transit?bbox=10.65,59.85,10.90,59.98",
    expectedFeed: "Entur Norway",
  },
  {
    name: "HSL HELSINKI",
    section: "transit",
    url: "/api/feeds/transit?bbox=24.90,60.15,25.15,60.30",
    expectedFeed: "HSL Helsinki region",
  },
  {
    name: "SOFIA TRANSIT",
    section: "transit",
    url: "/api/feeds/transit?bbox=23.30,42.60,23.40,42.75",
    expectedFeed: "Sofia Traffic",
  },
  {
    name: "ROME TRANSIT",
    section: "transit",
    url: "/api/feeds/transit?bbox=12.45,41.85,12.55,41.95",
    expectedFeed: "Roma Mobilità",
  },
  {
    name: "LVIV TRANSIT",
    section: "transit",
    url: "/api/feeds/transit?bbox=23.95,49.80,24.05,49.90",
    expectedFeed: "Lvivavtodor",
  },
  {
    name: "BUCHAREST TRANSIT",
    section: "transit",
    url: "/api/feeds/transit?bbox=26.00,44.40,26.15,44.50",
    expectedFeed: "Bucharest TPBI",
  },
  {
    name: "TRANSLINK QUEENSLAND",
    section: "transit",
    url: "/api/feeds/transit?bbox=153.00,-27.60,153.15,-27.45",
    expectedFeed: "TransLink Queensland",
  },
  {
    name: "ADELAIDE METRO",
    section: "transit",
    url: "/api/feeds/transit?bbox=138.55,-34.95,138.65,-34.85",
    expectedFeed: "Adelaide Metro",
  },
  {
    name: "CARTO BASEMAP",
    section: "tiles",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  },
  {
    name: "ESRI SATELLITE TILES",
    section: "tiles",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/1",
  },
  {
    name: "AWS TERRAIN TILES",
    section: "tiles",
    url: "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/2/1/1.png",
  },
  {
    name: "LOCAL AI / OLLAMA",
    section: "core",
    url: "/api/nova/models",
    availabilityField: "available",
  },
  {
    name: "TELEGRAM",
    section: "social",
    url: "/api/telegram/status",
    statusField: "authorized",
  },
  { name: "DISCORD", section: "social", tokenKey: "discord_bot_token" },
  {
    name: "KRYNARA WHATSAPP",
    section: "social",
    url: "/api/whatsapp/status",
    statusField: "status",
  },
  {
    name: "INSTAGRAM",
    section: "social",
    tokenKey: "instagram_token",
    userIdKey: "instagram_user_id",
  },
];

// ---------------------------------------------------------------------------
// Tuning constants (fixes #1, #3, #4)
// ---------------------------------------------------------------------------

/** At most 5 health probes in flight at once — was 12, which saturated CPU. */
const CHECK_CONCURRENCY = 5;
/** Stagger between probe launches so requests never fire as one thundering herd. */
const CHECK_STAGGER_MS = 150;
/** Hard per-request ceiling. Was 3500ms; a slow endpoint must fail fast. */
const CHECK_TIMEOUT_MS = 1500;
/** Never refetch the same endpoint more than once a minute. */
const AUTO_CHECK_INTERVAL_MS = 60_000;
/** Base backoff before a failed endpoint is retried. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 300_000;
/** 5 minutes for weather / transit / satellite, 60s for live feeds. */
const STATIC_TTL_MS = 300_000;
const LIVE_TTL_MS = 60_000;
/** One polling timer for the whole page. */
const TICK_MS = 1000;
const STATS_EVERY_TICKS = 3;
const LOGS_EVERY_TICKS = 10;
const AUTO_EVERY_TICKS = AUTO_CHECK_INTERVAL_MS / TICK_MS;

const CACHE_STORAGE_KEY = "krynara_diag_cache_v1";

type CacheEntry = { checkedAtMs: number; result: ApiCheck };
const memCache = new Map<string, CacheEntry>();
let persistTimer: number | null = null;

function ttlFor(name: string): number {
  return /WEATHER|TRANSIT|SATELLITE|METRO|DIRECTIONS|OSRM/i.test(name)
    ? STATIC_TTL_MS
    : LIVE_TTL_MS;
}

function readPersistedCache() {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [name, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.checkedAtMs === "number" && entry.result)
        memCache.set(name, entry);
    }
  } catch {
    /* corrupt cache is not fatal */
  }
}

function persistCache() {
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      const dump: Record<string, CacheEntry> = {};
      for (const [name, entry] of memCache) dump[name] = entry;
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(dump));
    } catch {
      /* quota or privacy mode — in-memory cache still works */
    }
  }, 500);
}

readPersistedCache();

function initialChecks(): ApiCheck[] {
  return checks.map((check) => ({
    ...check,
    status: "idle",
    latency: null,
    lastChecked: "NOT CHECKED",
    checkedAtMs: null,
    detail: "PRESS CHECK TO PROBE",
  }));
}

function formatCheckTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(ms: number | null): string {
  if (ms === null) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Fixed-concurrency map with a launch stagger and abort support. */
async function runQueue<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let cursor = 0;
  const laneCount = Math.min(limit, items.length);
  const lanes = Array.from({ length: laneCount }, async () => {
    while (cursor < items.length) {
      if (signal.aborted) return;
      const index = cursor++;
      await worker(items[index]!);
      if (signal.aborted) return;
      await sleep(CHECK_STAGGER_MS, signal);
    }
  });
  await Promise.all(lanes);
}

function isTimeoutError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return (
    reason.name === "TimeoutError" ||
    reason.name === "AbortError" ||
    /abort|timeout/i.test(reason.message)
  );
}

async function checkApi(
  check: CheckConfig,
  signal: AbortSignal,
): Promise<ApiCheck> {
  const checkedAtMs = Date.now();
  const checkedAt = formatCheckTime();

  if (check.tokenKey) {
    const token = localStorage.getItem(check.tokenKey);
    const userId = check.userIdKey ? localStorage.getItem(check.userIdKey) : "";
    if (!token || (check.userIdKey && !userId)) {
      return {
        ...check,
        status: "unconfigured",
        latency: null,
        lastChecked: checkedAt,
        checkedAtMs,
        detail: "ADD USER-OWNED CREDENTIALS IN SOCIAL HUB",
      };
    }

    let url = "";
    const headers = new Headers();
    if (check.name === "TELEGRAM") {
      url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`;
    } else if (check.name === "DISCORD") {
      url = "https://discord.com/api/v10/users/@me";
      headers.set("Authorization", `Bot ${token}`);
    } else if (check.name === "WHATSAPP") {
      url = `https://graph.facebook.com/v23.0/${encodeURIComponent(userId!)}?fields=id`;
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      url = `https://graph.facebook.com/v23.0/${encodeURIComponent(userId!)}?fields=id,username`;
      headers.set("Authorization", `Bearer ${token}`);
    }
    return performCheck(check, url, headers, signal, checkedAt, checkedAtMs);
  }
  return performCheck(
    check,
    check.url!,
    new Headers(),
    signal,
    checkedAt,
    checkedAtMs,
  );
}

async function performCheck(
  check: CheckConfig,
  url: string,
  headers: Headers,
  outerSignal: AbortSignal,
  checkedAt: string,
  checkedAtMs: number,
): Promise<ApiCheck> {
  const start = performance.now();
  try {
    // Outer signal cancels on navigation/new run; timeout caps a slow endpoint.
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.any([
        outerSignal,
        AbortSignal.timeout(CHECK_TIMEOUT_MS),
      ]),
    });
    const latency = Math.round(performance.now() - start);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json().catch(() => null)) as {
      [key: string]: unknown;
      ok?: boolean;
      error?: { message?: string };
    } | null;
    if (check.availabilityField && body?.[check.availabilityField] === false)
      throw new Error("SERVICE UNAVAILABLE");
    if (body?.ok === false)
      throw new Error(body.error?.message || "API rejected the check.");
    if (check.expectedFeed) {
      const feeds = body?.feeds as
        | Array<{ feed?: string; count?: number; error?: string }>
        | undefined;
      const feed = feeds?.find((item) => item.feed === check.expectedFeed);
      if (!feed) throw new Error("FEED NOT AVAILABLE IN THIS REGION");
      if (feed.error) throw new Error(feed.error);
      return {
        ...check,
        status: "online",
        latency,
        lastChecked: checkedAt,
        checkedAtMs,
        detail: `FEED RESPONDED · ${feed.count ?? 0} VEHICLES`,
      };
    }
    if (check.statusField) {
      const value = body?.[check.statusField];
      const ok = value === "online" || value === true;
      if (!ok) {
        return {
          ...check,
          status: "offline",
          latency,
          lastChecked: checkedAt,
          checkedAtMs,
          detail:
            typeof value === "string"
              ? `SESSION ${value.toUpperCase()}`
              : "SESSION NOT READY",
        };
      }
      const user = (body as { user?: { username?: string } } | undefined)?.user;
      return {
        ...check,
        status: "online",
        latency,
        lastChecked: checkedAt,
        checkedAtMs,
        detail: user?.username
          ? `LOGGED IN AS @${String(user.username).toUpperCase()}`
          : "SESSION READY",
      };
    }
    return {
      ...check,
      status: "online",
      latency,
      lastChecked: checkedAt,
      checkedAtMs,
      detail: "ENDPOINT RESPONDED",
    };
  } catch (reason) {
    const latency = Math.round(performance.now() - start);
    if (outerSignal.aborted) throw reason; // caller abandons the result, no state churn
    const msg = reason instanceof Error ? reason.message : String(reason);
    const timedOut = isTimeoutError(reason) || latency >= CHECK_TIMEOUT_MS;
    return {
      ...check,
      status: timedOut ? "timeout" : "offline",
      latency,
      lastChecked: checkedAt,
      checkedAtMs,
      detail: timedOut
        ? `TIMEOUT (>${CHECK_TIMEOUT_MS / 1000}s) // REMOTE DELAY`
        : msg.toUpperCase(),
    };
  }
}

export function DiagnosticsView() {
  const [apiChecks, setApiChecks] = useState<ApiCheck[]>(initialChecks);
  const [section, setSection] = useState<Section | "all">("all");
  const [running, setRunning] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<CpuPoint[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [gatewayMessage, setGatewayMessage] = useState("");
  const [now, setNow] = useState(() => new Date());

  const logPaneRef = useRef<HTMLDivElement>(null);
  const runControllerRef = useRef<AbortController | null>(null);
  const hasRunRef = useRef<Set<string>>(new Set());
  const failCountRef = useRef<Map<string, number>>(new Map());
  const retryAtRef = useRef<Map<string, number>>(new Map());
  const runningRef = useRef(false);
  const runChecksRef = useRef<(names: string[]) => void>(() => {});

  const byName = useMemo(
    () => new Map(checks.map((check) => [check.name, check])),
    [],
  );
  const visibleChecks = useMemo(
    () =>
      section === "all"
        ? apiChecks
        : apiChecks.filter((check) => check.section === section),
    [apiChecks, section],
  );

  const patchCheck = useCallback((name: string, next: ApiCheck) => {
    setApiChecks((current) =>
      current.map((check) => (check.name === name ? next : check)),
    );
    hasRunRef.current.add(name);
  }, []);

  /**
   * Runs one bounded, staggered pass over *names*. Fresh cache entries are used
   * as-is; stale ones render immediately and revalidate in the background
   * (stale-while-revalidate). Failures enter exponential backoff.
   */
  const runChecks = useCallback(
    async (names: string[]) => {
      const targets = names
        .map((name) => byName.get(name))
        .filter((check): check is CheckConfig => Boolean(check));
      if (!targets.length || runningRef.current) return;

      runControllerRef.current?.abort();
      const controller = new AbortController();
      runControllerRef.current = controller;
      runningRef.current = true;
      setRunning(true);

      setApiChecks((current) =>
        current.map((check) =>
          targets.some((target) => target.name === check.name) &&
          check.status === "idle"
            ? { ...check, status: "checking", detail: "PROBING…" }
            : check,
        ),
      );

      try {
        await runQueue(
          targets,
          CHECK_CONCURRENCY,
          async (config) => {
            if (controller.signal.aborted) return;

            const retryAt = retryAtRef.current.get(config.name) ?? 0;
            if (Date.now() < retryAt) return;

            const cached = memCache.get(config.name);
            const ttl = ttlFor(config.name);
            const cacheAge = cached
              ? Date.now() - cached.checkedAtMs
              : Infinity;

            if (cached && cacheAge < ttl) {
              // Fresh cache: use it, skip the network entirely.
              setApiChecks((current) =>
                current.map((check) =>
                  check.name === config.name
                    ? {
                        ...cached.result,
                        detail: `${cached.result.detail} · cached ${formatAge(cached.checkedAtMs)}`,
                      }
                    : check,
                ),
              );
              return;
            }

            if (cached) {
              // Stale: paint cached state now, then revalidate.
              setApiChecks((current) =>
                current.map((check) =>
                  check.name === config.name
                    ? {
                        ...cached.result,
                        detail: `${cached.result.detail} · stale ${formatAge(cached.checkedAtMs)}`,
                      }
                    : check,
                ),
              );
            }

            try {
              const result = await checkApi(config, controller.signal);
              if (controller.signal.aborted) return;
              patchCheck(config.name, result);
              if (result.status === "online") {
                memCache.set(config.name, {
                  checkedAtMs: result.checkedAtMs ?? Date.now(),
                  result,
                });
                persistCache();
                failCountRef.current.set(config.name, 0);
                retryAtRef.current.delete(config.name);
              } else {
                const failures =
                  (failCountRef.current.get(config.name) ?? 0) + 1;
                failCountRef.current.set(config.name, failures);
                retryAtRef.current.set(
                  config.name,
                  Date.now() +
                    Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS),
                );
              }
            } catch {
              /* aborted — a newer run owns the UI now */
            }
          },
          controller.signal,
        );
      } finally {
        if (!controller.signal.aborted) {
          runningRef.current = false;
          setRunning(false);
        }
      }
    },
    [byName, patchCheck],
  );

  useEffect(() => {
    runChecksRef.current = (names) => {
      void runChecks(names);
    };
  }, [runChecks]);

  // Single polling timer for API auto-checks, host stats, logs, and the clock.
  useEffect(() => {
    let alive = true;
    let tick = 0;
    let statsAbort: AbortController | null = null;
    let logsAbort: AbortController | null = null;

    const loadStats = async () => {
      statsAbort?.abort();
      const controller = new AbortController();
      statsAbort = controller;
      try {
        const response = await fetch("/api/system-stats", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = (await response.json()) as SystemStats;
        if (!alive) return;
        setSystemStats(result);
        setCpuHistory((current) => [
          ...current.slice(-39),
          {
            time: formatCheckTime(),
            cpu: result.cpuLoad,
            memory: result.memoryLoad,
            disk: result.diskLoad,
          },
        ]);
      } catch {
        if (!alive) return;
        setCpuHistory((current) => [
          ...current.slice(-39),
          { time: formatCheckTime(), cpu: null, memory: null, disk: null },
        ]);
      }
    };

    const loadLogs = async () => {
      logsAbort?.abort();
      const controller = new AbortController();
      logsAbort = controller;
      try {
        const response = await fetch("/api/logs", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = (await response.json()) as { logs?: string[] };
        if (alive) setLogs(result.logs ?? []);
      } catch (reason) {
        if (
          alive &&
          !(reason instanceof Error && reason.name === "AbortError")
        ) {
          setLogs([
            `[${formatCheckTime()}] LOG VIEWER ERROR: ${reason instanceof Error ? reason.message : String(reason)}`,
          ]);
        }
      }
    };

    void loadStats();
    void loadLogs();

    const timer = window.setInterval(() => {
      if (!alive || document.visibilityState === "hidden") return;
      tick += 1;
      setNow(new Date());
      if (tick % STATS_EVERY_TICKS === 0) void loadStats();
      if (tick % LOGS_EVERY_TICKS === 0) void loadLogs();
      if (tick % AUTO_EVERY_TICKS === 0) {
        // Auto-check only what the user has already probed — never all 32 blind.
        const names = Array.from(hasRunRef.current);
        if (names.length) runChecksRef.current(names);
      }
    }, TICK_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
      statsAbort?.abort();
      logsAbort?.abort();
    };
  }, []);

  // Abort in-flight probes when the view unmounts (fixes the pending-fetch leak).
  useEffect(
    () => () => {
      runControllerRef.current?.abort();
      runningRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const pane = logPaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [logs]);

  const restartGateway = async () => {
    setGatewayMessage("REQUESTING GATEWAY RESTART…");
    try {
      const response = await fetch("/api/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok)
        throw new Error(`Restart request returned HTTP ${response.status}`);
      const result = (await response.json()) as { message?: string };
      setGatewayMessage(result.message ?? "Gateway restart requested.");
    } catch (reason) {
      setGatewayMessage(
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  };

  const onlineCount = apiChecks.filter(
    (check) => check.status === "online",
  ).length;
  // Mean latency uses successful probes only — timeouts must not inflate it.
  const successful = apiChecks.filter(
    (check) => check.status === "online" && check.latency !== null,
  );
  const averageLatency = successful.length
    ? Math.round(
        successful.reduce((sum, check) => sum + (check.latency ?? 0), 0) /
          successful.length,
      )
    : null;
  const timeoutCount = apiChecks.filter(
    (check) => check.status === "timeout",
  ).length;
  const cachedCount = apiChecks.filter((check) => {
    const entry = memCache.get(check.name);
    return Boolean(
      entry && Date.now() - entry.checkedAtMs < ttlFor(check.name),
    );
  }).length;

  const runVisible = () => {
    const names = visibleChecks.map((check) => check.name);
    void runChecks(names);
  };

  const runAll = () => {
    void runChecks(checks.map((check) => check.name));
  };

  return (
    <div className="diagnostics-page">
      <div className="krynara-grid krynara-grid-3">
        <StatusCard
          label="API SERVICES ONLINE"
          value={`${onlineCount} / ${apiChecks.length}`}
          sub={`${cachedCount} SERVED FROM CACHE`}
          status={onlineCount ? "online" : "warning"}
        />
        <StatusCard
          label="MEAN API LATENCY"
          value={averageLatency === null ? "--" : `${averageLatency}ms`}
          sub={`${successful.length} SUCCESSFUL · ${timeoutCount} TIMEOUT`}
          status={
            averageLatency === null
              ? "warning"
              : averageLatency > 500
                ? "offline"
                : averageLatency > 200
                  ? "warning"
                  : "online"
          }
        />
        <StatusCard
          label="LAST CHECK"
          value={new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(now)}
          sub="AUTO CHECK 60S · HOST SAMPLE 3S"
        />
      </div>

      <div className="diagnostics-toolbar">
        <div
          className="diagnostics-filters"
          role="group"
          aria-label="Filter checks by section"
        >
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`hud-button${section === entry.id ? " hud-button-active" : ""}`}
              aria-pressed={section === entry.id}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="diagnostics-actions">
          <span className="diagnostics-run-state">
            {running
              ? `PROBING ${visibleChecks.length} ENDPOINTS…`
              : `IDLE · ${visibleChecks.length} IN VIEW`}
          </span>
          <button
            type="button"
            className="hud-button"
            onClick={runVisible}
            disabled={running}
          >
            {running ? "CHECKING…" : `CHECK VIEW (${visibleChecks.length})`}
          </button>
          <button
            type="button"
            className="hud-button"
            onClick={runAll}
            disabled={running}
          >
            {running ? "CHECKING…" : `CHECK ALL (${checks.length})`}
          </button>
        </div>
      </div>

      <div className="diagnostics-layout">
        <HudFrame
          title="API CONNECTIVITY // LIVE"
          className="diagnostics-services"
        >
          <div className="diagnostics-check-list">
            {visibleChecks.map((check) => (
              <div className="diagnostics-check" key={check.name}>
                <span className={`diagnostics-indicator ${check.status}`}>
                  <span className="status-dot" />
                </span>
                <strong>{check.name}</strong>
                <span className="diagnostics-detail">{check.detail}</span>
                <span
                  className="diagnostics-latency"
                  style={{
                    color:
                      check.latency === null
                        ? undefined
                        : check.latency < 200
                          ? "var(--krynara-green)"
                          : check.latency <= 500
                            ? "var(--krynara-amber)"
                            : "var(--krynara-red)",
                  }}
                >
                  {check.latency === null ? "—" : `${check.latency} ms`}
                </span>
                <time>{check.lastChecked}</time>
              </div>
            ))}
          </div>
        </HudFrame>

        <div className="diagnostics-side">
          <HudFrame
            title="HOST LOAD // LAST 40 SAMPLES"
            className="diagnostics-chart-panel"
          >
            <div className="diagnostics-host-summary">
              <GaugeCircle
                label="CPU LOAD"
                value={
                  systemStats ? `${systemStats.cpuLoad.toFixed(0)}%` : "--"
                }
                sub="LIVE"
                percent={systemStats?.cpuLoad ?? 0}
                size={132}
              />
              <div className="diagnostics-host-values">
                <div>
                  <span>CPU</span>
                  <strong>
                    {systemStats ? `${systemStats.cpuLoad.toFixed(1)}%` : "—"}
                  </strong>
                </div>
                <div>
                  <span>MEMORY</span>
                  <strong>
                    {systemStats
                      ? `${systemStats.memoryUsedGb.toFixed(1)} / ${systemStats.memoryTotalGb.toFixed(1)} GB`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>DISK</span>
                  <strong>
                    {systemStats
                      ? `${systemStats.diskUsedGb.toFixed(1)} / ${systemStats.diskTotalGb.toFixed(1)} GB`
                      : "—"}
                  </strong>
                </div>
              </div>
            </div>
            {cpuHistory.length ? (
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 400, height: 220 }}
              >
                <AreaChart
                  data={cpuHistory}
                  margin={{ top: 8, right: 12, bottom: 4, left: -18 }}
                >
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#8AF8FF"
                        stopOpacity={0.28}
                      />
                      <stop offset="95%" stopColor="#8AF8FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="rgba(138,248,255,.12)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#9ab8bd", fontSize: 9 }}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#9ab8bd", fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#07151b",
                      border: "1px solid #8AF8FF",
                      color: "#E6FBFF",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#8AF8FF"
                    fill="url(#cpuFill)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="memory"
                    name="MEM %"
                    stroke="#FFD700"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="disk"
                    name="DISK %"
                    stroke="#00FF88"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="diagnostics-empty">WAITING FOR HOST METRICS</div>
            )}
          </HudFrame>
          <HudFrame title="GATEWAY LOGS" className="diagnostics-logs">
            <div
              className="log-viewer"
              ref={logPaneRef}
              role="log"
              aria-live="polite"
            >
              {logs.length ? (
                logs.map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))
              ) : (
                <div>Waiting for gateway logs…</div>
              )}
            </div>
            <div className="gateway-restart">
              <button
                type="button"
                className="hud-button"
                onClick={() => void restartGateway()}
              >
                RESTART GATEWAY
              </button>
              {gatewayMessage && <span role="status">{gatewayMessage}</span>}
            </div>
          </HudFrame>
        </div>
      </div>
      <p className="diagnostics-note">
        SOCIAL API CHECKS USE ONLY TOKENS YOU CONFIGURE IN THIS BROWSER. NO
        SCRAPING OR THIRD-PARTY TOKEN RELAYS.
      </p>
    </div>
  );
}
