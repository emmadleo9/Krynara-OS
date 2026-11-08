import { useEffect, useState } from 'react';
import { HudFrame } from '@/components/hud';
import { swarmStore } from './swarmStore';
import type { SwarmConfig, SwarmTelemetry } from './swarmTypes';

export function SwarmSettingsPanel() {
  const [config, setConfig] = useState<SwarmConfig>(() => swarmStore.getConfig());
  const [telemetry, setTelemetry] = useState<SwarmTelemetry>(() => swarmStore.getTelemetry());

  useEffect(() => {
    const unsub = swarmStore.subscribe(() => {
      setConfig({ ...swarmStore.getConfig() });
      setTelemetry({ ...swarmStore.getTelemetry() });
    });
    return unsub;
  }, []);

  const progressPct =
    telemetry.totalLayers > 0
      ? Math.round((telemetry.layersBuilt / telemetry.totalLayers) * 100)
      : telemetry.state === 'BUILDING'
      ? 50
      : 100;

  return (
    <HudFrame title="KRYNARA SWARM ENGINE // MULTIPLAYER REBUILD MATRIX">
      <div className="swarm-settings-grid">
        <p className="credential-notice">
          The Swarm Engine operates a fleet of multiplayer cursor agents that reconstruct Krynara-OS elements live. It operates by default across all views: building on scroll, drafting elements as the user touches/interacts with them, rendering crosshair boxes, pen lines, carets, guides, and playing spatial procedural Web Audio chimes.
        </p>

        {/* Live Telemetry Strip */}
        <div className="swarm-telemetry-strip">
          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">FLEET STATUS</span>
            <div className="swarm-telemetry-val">
              <span className={`status-dot${config.enabled ? '' : ' status-dot-offline'}`} />
              <strong>{config.enabled ? telemetry.state : 'OFFLINE'}</strong>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">ONLINE AGENTS</span>
            <div className="swarm-telemetry-val">
              <span>{telemetry.activeAgents} / {telemetry.totalAgents}</span>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">LAYERS REBUILT</span>
            <div className="swarm-telemetry-val">
              <span>{telemetry.layersBuilt}</span>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">TASK BACKLOG</span>
            <div className="swarm-telemetry-val">
              <span>{telemetry.backlog}</span>
            </div>
          </div>

          <div className="swarm-progress-bar-wrap">
            <div className="swarm-telemetry-label" style={{ marginBottom: 4 }}>
              REBUILD PROGRESS ({progressPct}%)
            </div>
            <div className="swarm-progress-bar">
              <div
                className="swarm-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Active Cursors Live Radar */}
        <div className="swarm-control-box">
          <div className="swarm-control-head">
            <span>ACTIVE MULTIPLAYER CURSOR RADAR</span>
            <small style={{ color: 'var(--krynara-muted)' }}>
              {telemetry.activeTasks.length > 0
                ? `${telemetry.activeTasks.length} BUSY AGENTS`
                : 'AGENTS IN PATROL FLOCKING FORMATION'}
            </small>
          </div>
          <div className="swarm-radar-box">
            {telemetry.activeTasks.length > 0 ? (
              telemetry.activeTasks.map((t, idx) => (
                <div className="swarm-radar-chip" key={idx}>
                  <span
                    className="swarm-radar-dot"
                    style={{ background: t.cursorColor }}
                  />
                  <strong>{t.cursorName}</strong>
                  <span style={{ color: 'var(--krynara-muted)' }}>{t.description}</span>
                </div>
              ))
            ) : (
              <span style={{ fontSize: 11, color: 'var(--krynara-muted)' }}>
                All cursors orbiting and standing by. Touch any button, frame, card, or scroll the page to deploy agents.
              </span>
            )}
          </div>
        </div>

        {/* Matrix Controls */}
        <div className="swarm-controls-matrix">
          {/* Master & Trigger Controls */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>MASTER CHOREOGRAPHY</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${config.enabled ? ' active' : ''}`}
                onClick={() => swarmStore.updateConfig({ enabled: !config.enabled })}
              >
                SWARM ENGINE {config.enabled ? 'ONLINE' : 'OFFLINE'}
              </button>
              <button
                type="button"
                className="swarm-btn"
                style={{ borderColor: 'var(--krynara-cyan)', color: 'var(--krynara-cyan)' }}
                onClick={() => swarmStore.triggerManualRebuild()}
              >
                ⚡ TRIGGER VIEW REBUILD
              </button>
              <button
                type="button"
                className={`swarm-btn${telemetry.tourActive ? ' active' : ''}`}
                onClick={() => swarmStore.toggleTour()}
              >
                {telemetry.tourActive ? 'AUTO-TOUR ACTIVE' : 'START TOUR MODE'}
              </button>
              <button
                type="button"
                className="swarm-btn"
                onClick={() => swarmStore.triggerFlockToCursor()}
              >
                FLOCK TO MOUSE
              </button>
            </div>
          </div>

          {/* Touch & Scroll Automation */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>INTERACTION TRIGGERS</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${config.buildOnTouch ? ' active' : ''}`}
                onClick={() =>
                  swarmStore.updateConfig({ buildOnTouch: !config.buildOnTouch })
                }
              >
                BUILD ON TOUCH/CLICK {config.buildOnTouch ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${config.buildOnScroll ? ' active' : ''}`}
                onClick={() =>
                  swarmStore.updateConfig({ buildOnScroll: !config.buildOnScroll })
                }
              >
                BUILD ON SCROLL {config.buildOnScroll ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Speed Selection */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>BUILD VELOCITY</span>
            </div>
            <div className="swarm-button-group">
              {([1, 2, 3] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`swarm-btn${config.speed === s ? ' active' : ''}`}
                  onClick={() => swarmStore.updateConfig({ speed: s })}
                >
                  {s}× SPEED
                </button>
              ))}
            </div>
          </div>

          {/* Procedural Audio Controls */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>PROCEDURAL WEB AUDIO (E PENTATONIC)</span>
            </div>
            <div className="swarm-button-group" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className={`swarm-btn${config.soundEnabled ? ' active' : ''}`}
                onClick={() =>
                  swarmStore.updateConfig({ soundEnabled: !config.soundEnabled })
                }
              >
                {config.soundEnabled ? '🔊 AUDIO ON' : '🔇 AUDIO MUTED'}
              </button>
            </div>
            <div className="swarm-slider-row">
              <span className="swarm-telemetry-label">VOL</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.volume}
                onChange={(e) =>
                  swarmStore.updateConfig({ volume: parseFloat(e.target.value) })
                }
              />
              <span style={{ fontSize: 11, minWidth: 32 }}>
                {Math.round(config.volume * 100)}%
              </span>
            </div>
          </div>

          {/* Fleet Density */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>FLEET DENSITY (MAX AGENTS)</span>
            </div>
            <div className="swarm-slider-row">
              <span className="swarm-telemetry-label">MIN 8</span>
              <input
                type="range"
                min="8"
                max="48"
                step="2"
                value={config.maxAgents}
                onChange={(e) =>
                  swarmStore.updateConfig({ maxAgents: parseInt(e.target.value, 10) })
                }
              />
              <span style={{ fontSize: 11, minWidth: 36, color: 'var(--krynara-cyan)' }}>
                {config.maxAgents}
              </span>
            </div>
          </div>
        </div>
      </div>
    </HudFrame>
  );
}

