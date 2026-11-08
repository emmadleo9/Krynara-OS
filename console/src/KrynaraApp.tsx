import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { HudFrame } from '@/components/hud';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { DevicesView } from '@/features/devices/DevicesView';
import { DiagnosticsView } from '@/features/diagnostics/DiagnosticsView';
import { NewsConflictView } from '@/features/feeds/NewsConflictView';
import { SocialHub } from '@/features/social/SocialHub';
import { TimeView } from '@/features/time/TimeView';
import { WeatherView } from '@/features/weather/WeatherView';
import { WorldView } from '@/features/world/WorldView';
import { NovaAssistant } from '@/features/nova/NovaAssistant';
import { AiStudio } from '@/features/studio/AiStudio';
import { SettingsView } from '@/features/settings/SettingsView';
import { KrynaraWhatsApp } from '@/features/social/KrynaraWhatsApp';
import { SwarmOverlay } from '@/features/swarm/SwarmOverlay';
import { initKrynaraStorage } from '@/services/persistentStorage';

const links = [
  ['/', '◈', 'DASHBOARD'],
  ['/world', '◎', 'WORLD VIEW'],
  ['/weather', '☼', 'WEATHER INTEL'],
  ['/feeds', '▤', 'NEWS & CONFLICT'],
  ['/social', '◌', 'SOCIAL HUB'],
  ['/whatsapp', '💬', 'KRYNARA WHATSAPP'],
  ['/scopes', '⌁', 'SCOPES & RADARS'],
  ['/devices', '▣', 'MY DEVICES'],
  ['/time', '◷', 'WORLD CLOCK'],
  ['/ai-studio', '✦', 'AI STUDIO'],
  ['/settings', '⚙', 'SETTINGS'],
  ['/diagnostics', '⌘', 'DIAGNOSTICS'],
];

function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [now, setNow] = useState(() => new Date());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [websiteScrollLock, setWebsiteScrollLock] = useState(
    () => localStorage.getItem('krynara_website_scroll_lock') !== 'false',
  );
  const [memorySaver, setMemorySaver] = useState(
    () => localStorage.getItem('krynara_memory_saver') !== 'false',
  );
  const titles: Record<string, string> = {
    '/': 'COMMAND DASHBOARD',
    '/world': 'WORLD VIEW',
    '/weather': 'WEATHER INTEL',
    '/feeds': 'NEWS & CONFLICT FEED',
    '/social': 'SOCIAL HUB',
    '/whatsapp': 'KRYNARA WHATSAPP',
    '/scopes': 'SCOPES & RADARS',
    '/devices': 'MY DEVICES',
    '/time': 'WORLD CLOCK & TIME INTEL',
    '/ai-studio': 'AI STUDIO — NOVA',
    '/settings': 'SETTINGS — MY ACCOUNTS',
    '/diagnostics': 'SYSTEM DIAGNOSTICS',
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    void initKrynaraStorage().catch((reason: unknown) => {
      console.error('KRYNARA persistent storage initialization failed:', reason);
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('krynara-scroll-locked', websiteScrollLock);
    localStorage.setItem('krynara_website_scroll_lock', String(websiteScrollLock));
  }, [websiteScrollLock]);

  useEffect(() => {
    localStorage.setItem('krynara_memory_saver', String(memorySaver));
    window.dispatchEvent(new CustomEvent('krynara:memory-saver-change', { detail: memorySaver }));
  }, [memorySaver]);

  return (
    <div className="krynara-app">
      {mobileNavOpen && <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <button type="button" className="mobile-nav-toggle" aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
        {mobileNavOpen ? '×' : '☰'}
      </button>
      <aside className={`krynara-sidebar${mobileNavOpen ? ' mobile-open' : ''}`}>
        <div className="krynara-brand">
          <img className="krynara-brand-logo" src="/krynara-official.png" alt="Krynara-OS official shield logo" />
          <span>Krynara-OS</span>
          <small>PUBLIC DATA CONSOLE // 04.0</small>
        </div>
        <nav className="krynara-nav" aria-label="Main navigation">
          {links.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileNavOpen(false)}>
              <span className="krynara-nav-icon" aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="hud-label">SYSTEM STATE</div>
          <div className="sidebar-status-value"><span className="status-dot" /> NOMINAL</div>
        </div>
      </aside>
      <main className="krynara-main">
        <header className="krynara-topline">
          <div>
            <div className="krynara-kicker">SYSTEM MONITOR v4.0 // Krynara-OS ONLINE</div>
            <h1 className="krynara-heading">{titles[pathname] ?? 'KRYNARA CONSOLE'}</h1>
          </div>
          <div className="krynara-clock">
            <div className="krynara-header-toggles">
              <button
                type="button"
                className={`device-tab${websiteScrollLock ? ' active' : ''}`}
                aria-pressed={websiteScrollLock}
                onClick={() => setWebsiteScrollLock((locked) => !locked)}
              >
                WEBSITE SCROLL LOCK {websiteScrollLock ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`device-tab${memorySaver ? ' active' : ''}`}
                aria-pressed={memorySaver}
                onClick={() => setMemorySaver((enabled) => !enabled)}
              >
                MEMORY SAVER + CHAT SCROLL {memorySaver ? 'ON' : 'OFF'}
              </button>
            </div>
            LOCAL NODE // ACTIVE
            <br />
            <span>{now.toISOString().replace('T', ' ').slice(0, 19)}Z</span>
          </div>
        </header>
        <div key={pathname} className="krynara-page">{children}</div>
        <NovaAssistant />
        <SwarmOverlay />
      </main>
    </div>
  );
}

function ScopesView() {
  return (
    <div className="krynara-grid krynara-grid-3">
      <HudFrame title="AVIATION SCOPE"><p className="scope-copy">Public ADS-B aircraft reports are refreshed every 15 seconds in World View.</p><NavLink className="hud-link" to="/world">OPEN LIVE MAP →</NavLink></HudFrame>
      <HudFrame title="SEISMIC SCOPE"><p className="scope-copy">USGS all-day earthquake reports are refreshed every 60 seconds.</p><NavLink className="hud-link" to="/world">OPEN LIVE MAP →</NavLink></HudFrame>
      <HudFrame title="WEATHER SCOPE"><p className="scope-copy">Open-Meteo current conditions and forecasts update once per minute.</p><NavLink className="hud-link" to="/weather">OPEN WEATHER →</NavLink></HudFrame>
    </div>
  );
}

function NotFound() {
  return <HudFrame title="ROUTE ERROR"><div className="hud-value not-found-title">INVALID URL</div><NavLink className="hud-link" to="/">RETURN TO DASHBOARD →</NavLink></HudFrame>;
}

export default function KrynaraApp() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/world" element={<WorldView />} />
          <Route path="/weather" element={<WeatherView />} />
          <Route path="/feeds" element={<NewsConflictView />} />
          <Route path="/social" element={<SocialHub />} />
          <Route path="/whatsapp" element={<KrynaraWhatsApp />} />
          <Route path="/scopes" element={<ScopesView />} />
          <Route path="/devices" element={<DevicesView />} />
          <Route path="/time" element={<TimeView />} />
          <Route path="/ai-studio" element={<AiStudio />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/diagnostics" element={<DiagnosticsView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
