import { useEffect, useState } from 'react';
import { HudFrame } from '@/components/hud';
import { swarmStore } from './swarmStore';
import type { SwarmArrowCustomization } from './swarmTypes';

interface TelemetryDetail {
  workers: number;
  total: number;
  done: number;
  speed: number;
  sound: boolean;
  tour: boolean;
  complete: boolean;
  started: boolean;
  pct: number;
}

const COLOR_PALETTES = [
  { id: 'cyan', label: 'CYAN OLED', dots: ['#8AF8FF', '#00F0FF', '#38BDF8'] },
  { id: 'matrix', label: 'MATRIX EMERALD', dots: ['#00FF9C', '#10B981', '#00E676'] },
  { id: 'amber', label: 'AMBER INTEL', dots: ['#FFC857', '#F59E0B', '#FFA000'] },
  { id: 'multi', label: 'MULTI RAINBOW', dots: ['#8AF8FF', '#00FF9C', '#FFC857', '#FF5F6D'] },
  { id: 'monochrome', label: 'MONOCHROME', dots: ['#FFFFFF', '#CBD5E1', '#64748B'] },
] as const;

export function SwarmSettingsPanel() {
  const [config, setConfig] = useState<SwarmArrowCustomization>(() => swarmStore.getConfig());
  const [telemetry, setTelemetry] = useState<TelemetryDetail>({
    workers: 18,
    total: 100,
    done: 100,
    speed: 2,
    sound: true,
    tour: false,
    complete: true,
    started: false,
    pct: 100,
  });

  // Subscribe to store updates
  useEffect(() => {
    return swarmStore.subscribe(() => {
      setConfig({ ...swarmStore.getConfig() });
    });
  }, []);

  // Listen to live engine telemetry
  useEffect(() => {
    const handleTelemetry = (e: Event) => {
      const detail = (e as CustomEvent<TelemetryDetail>).detail;
      if (detail) {
        setTelemetry(detail);
      }
    };

    window.addEventListener('krynara:swarm:telemetry', handleTelemetry);
    return () => {
      window.removeEventListener('krynara:swarm:telemetry', handleTelemetry);
    };
  }, []);

  const updateSetting = <K extends keyof SwarmArrowCustomization>(
    key: K,
    val: SwarmArrowCustomization[K],
  ) => {
    swarmStore.updateConfig({ [key]: val });
  };

  const triggerRebuild = () => {
    swarmStore.triggerManualRebuild();
  };

  const toggleTour = () => {
    swarmStore.toggleTour();
    setTelemetry((prev) => ({ ...prev, tour: !prev.tour }));
  };

  const pct = telemetry.total ? Math.round((telemetry.done / telemetry.total) * 100) : 100;

  return (
    <HudFrame title="KRYNARA SWARM ENGINE v4.0.1.16 // MULTIPLAYER REBUILD MATRIX">
      <div className="swarm-settings-grid">
        <p className="credential-notice">
          Customization matrix for the Joel Califa multiplayer cursor fleet. Arrow agents navigate in from the top-right corner, rebuild live DOM components, then gather at the center and depart to the top-right corner to vanish. All settings below persist in local storage and apply immediately.
        </p>

        {/* Live Telemetry Strip */}
        <div className="swarm-telemetry-strip">
          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">SYSTEM STATE</span>
            <div className="swarm-telemetry-val">
              <span className={`status-dot${config.enabled ? '' : ' status-dot-offline'}`} />
              <strong>{config.enabled ? (telemetry.complete ? 'PAGE LIVE / NOMINAL' : 'REBUILDING VIEW') : 'SYSTEM MUTED'}</strong>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">FLEET SIZE</span>
            <div className="swarm-telemetry-val">
              <span>{config.agentCount} AGENTS</span>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">LAYERS REBUILT</span>
            <div className="swarm-telemetry-val">
              <span>{telemetry.done} / {telemetry.total}</span>
            </div>
          </div>

          <div className="swarm-progress-bar-wrap">
            <div className="swarm-telemetry-label" style={{ marginBottom: 4 }}>
              REBUILD PROGRESS ({pct}%)
            </div>
            <div className="swarm-progress-bar">
              <div
                className="swarm-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Matrix Controls */}
        <div className="swarm-controls-matrix">
          {/* Master Switch & Test Actions */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>MASTER CONTROLS & TEST ACTIONS</span>
              <span style={{ color: config.enabled ? 'var(--krynara-cyan)' : 'var(--krynara-amber)' }}>
                {config.enabled ? 'ACTIVE' : 'OFFLINE'}
              </span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${config.enabled ? ' active' : ''}`}
                onClick={() => updateSetting('enabled', !config.enabled)}
              >
                SWARM FLEET: {config.enabled ? 'ENABLED' : 'DISABLED'}
              </button>
              <button
                type="button"
                className="swarm-btn"
                style={{ borderColor: 'var(--krynara-cyan)', color: 'var(--krynara-cyan)', fontWeight: 700 }}
                onClick={triggerRebuild}
              >
                ⚡ TEST REBUILD NOW
              </button>
              <button
                type="button"
                className={`swarm-btn${telemetry.tour ? ' active' : ''}`}
                onClick={toggleTour}
              >
                {telemetry.tour ? 'AUTO-TOUR ACTIVE' : 'START TOUR'}
              </button>
              <button
                type="button"
                className="swarm-btn"
                onClick={() => swarmStore.resetDefaults()}
              >
                RESTORE DEFAULTS
              </button>
            </div>
          </div>

          {/* Arrow Fleet Size */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>ARROW FLEET SIZE</span>
              <span>{config.agentCount} AGENTS</span>
            </div>
            <div className="swarm-button-group">
              {[
                { count: 6, label: '6 RECON' },
                { count: 12, label: '12 SQUAD' },
                { count: 18, label: '18 FLEET' },
                { count: 28, label: '28 SWARM' },
              ].map(({ count, label }) => (
                <button
                  key={count}
                  type="button"
                  className={`swarm-btn${config.agentCount === count ? ' active' : ''}`}
                  onClick={() => updateSetting('agentCount', count)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="swarm-slider-row" style={{ marginTop: 8 }}>
              <input
                type="range"
                min="4"
                max="36"
                step="2"
                value={config.agentCount}
                onChange={(e) => updateSetting('agentCount', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Arrow Color Themes */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>ARROW COLOR THEME</span>
              <span>{config.colorTheme.toUpperCase()}</span>
            </div>
            <div className="swarm-button-group">
              {COLOR_PALETTES.map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  className={`swarm-theme-chip${config.colorTheme === pal.id ? ' active' : ''}`}
                  onClick={() => updateSetting('colorTheme', pal.id as SwarmArrowCustomization['colorTheme'])}
                >
                  <div className="swarm-palette-preview">
                    {pal.dots.map((d, i) => (
                      <span
                        key={i}
                        className="swarm-palette-dot"
                        style={{ backgroundColor: d, color: d }}
                      />
                    ))}
                  </div>
                  <span>{pal.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Build Velocity / Speed */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>FLIGHT & BUILD VELOCITY</span>
              <span>{config.speed}× SPEED</span>
            </div>
            <div className="swarm-button-group">
              {[
                { s: 1, label: '1× NORMAL' },
                { s: 2, label: '2× FAST' },
                { s: 3, label: '3× HYPER' },
                { s: 4, label: '4× SINGULARITY' },
              ].map(({ s, label }) => (
                <button
                  key={s}
                  type="button"
                  className={`swarm-btn${config.speed === s ? ' active' : ''}`}
                  onClick={() => updateSetting('speed', s)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Arrow Scale & Aesthetics */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>ARROW SCALE & AESTHETICS</span>
              <span>{config.arrowScale}× SCALE</span>
            </div>
            <div className="swarm-button-group">
              {[
                { scale: 0.8, label: '0.8× COMPACT' },
                { scale: 1.0, label: '1.0× STANDARD' },
                { scale: 1.3, label: '1.3× TACTICAL' },
              ].map(({ scale, label }) => (
                <button
                  key={scale}
                  type="button"
                  className={`swarm-btn${config.arrowScale === scale ? ' active' : ''}`}
                  onClick={() => updateSetting('arrowScale', scale)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`swarm-btn${config.showTags ? ' active' : ''}`}
                onClick={() => updateSetting('showTags', !config.showTags)}
              >
                NAME TAGS {config.showTags ? 'VISIBLE' : 'HIDDEN'}
              </button>
              <button
                type="button"
                className={`swarm-btn${config.arrowGlow ? ' active' : ''}`}
                onClick={() => updateSetting('arrowGlow', !config.arrowGlow)}
              >
                CYBER GLOW {config.arrowGlow ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Procedural Web Audio */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>PROCEDURAL WEB AUDIO (E PENTATONIC)</span>
              <span>{config.soundEnabled ? `${Math.round(config.soundVolume * 100)}% VOL` : 'MUTED'}</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${config.soundEnabled ? ' active' : ''}`}
                onClick={() => updateSetting('soundEnabled', !config.soundEnabled)}
              >
                {config.soundEnabled ? '🔊 AUDIO ON' : '🔇 AUDIO MUTED'}
              </button>
              {[
                { v: 0.3, label: '30% LOW' },
                { v: 0.6, label: '60% MED' },
                { v: 0.8, label: '80% HIGH' },
                { v: 1.0, label: '100% MAX' },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  className={`swarm-btn${config.soundVolume === v && config.soundEnabled ? ' active' : ''}`}
                  onClick={() => {
                    updateSetting('soundVolume', v);
                    if (!config.soundEnabled) updateSetting('soundEnabled', true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Automation Triggers */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>AUTOMATION TRIGGERS</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${config.autoNav ? ' active' : ''}`}
                onClick={() => updateSetting('autoNav', !config.autoNav)}
              >
                BUILD ON ROUTE CHANGE {config.autoNav ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${config.autoScroll ? ' active' : ''}`}
                onClick={() => updateSetting('autoScroll', !config.autoScroll)}
              >
                BUILD ON SCROLL {config.autoScroll ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${config.autoTouch ? ' active' : ''}`}
                onClick={() => updateSetting('autoTouch', !config.autoTouch)}
              >
                BUILD ON TOUCH / CLICK {config.autoTouch ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${config.showFloatingHud ? ' active' : ''}`}
                onClick={() => updateSetting('showFloatingHud', !config.showFloatingHud)}
              >
                BOTTOM HUD BAR {config.showFloatingHud ? 'ALWAYS VISIBLE' : 'ONLY IN SETTINGS'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </HudFrame>
  );
}
