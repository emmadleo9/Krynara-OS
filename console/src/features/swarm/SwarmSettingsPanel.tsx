import { useEffect, useState } from 'react';
import { HudFrame } from '@/components/hud';

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

export function SwarmSettingsPanel() {
  const [telemetry, setTelemetry] = useState<TelemetryDetail>({
    workers: 18,
    total: 100,
    done: 100,
    speed: 1,
    sound: true,
    tour: false,
    complete: true,
    started: false,
    pct: 100,
  });

  const [autoNav, setAutoNav] = useState(
    () => localStorage.getItem('krynara_swarm_auto_nav') !== 'false',
  );
  const [autoTouch, setAutoTouch] = useState(
    () => localStorage.getItem('krynara_swarm_auto_touch') !== 'false',
  );
  const [showFloatingHud, setShowFloatingHud] = useState(
    () => localStorage.getItem('krynara_swarm_show_floating_hud') === 'true',
  );

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

  const triggerRebuild = () => {
    if (window.__swarmRebuild) {
      window.__swarmRebuild.restart();
    }
  };

  const triggerGoLive = () => {
    if (window.__swarmRebuild) {
      window.__swarmRebuild.stop(true);
    }
  };

  const setSpeed = (s: number) => {
    if (window.__swarmRebuild) {
      window.__swarmRebuild.setSpeed(s);
      setTelemetry((prev) => ({ ...prev, speed: s }));
    }
  };

  const setSound = (on: boolean) => {
    if (window.__swarmRebuild) {
      window.__swarmRebuild.setSound(on);
      setTelemetry((prev) => ({ ...prev, sound: on }));
    }
  };

  const toggleTour = () => {
    if (window.__swarmRebuild) {
      window.__swarmRebuild.toggleTour();
      setTelemetry((prev) => ({ ...prev, tour: !prev.tour }));
    }
  };

  const toggleAutoNav = () => {
    const next = !autoNav;
    setAutoNav(next);
    localStorage.setItem('krynara_swarm_auto_nav', String(next));
  };

  const toggleAutoTouch = () => {
    const next = !autoTouch;
    setAutoTouch(next);
    localStorage.setItem('krynara_swarm_auto_touch', String(next));
  };

  const toggleFloatingHud = () => {
    const next = !showFloatingHud;
    setShowFloatingHud(next);
    localStorage.setItem('krynara_swarm_show_floating_hud', String(next));
    window.__swarmShowFloatingHud = next;
  };

  const pct = telemetry.total ? Math.round((telemetry.done / telemetry.total) * 100) : 100;

  return (
    <HudFrame title="KRYNARA SWARM ENGINE v4.0.1.16 // MULTIPLAYER REBUILD MATRIX">
      <div className="swarm-settings-grid">
        <p className="credential-notice">
          The Swarm Engine runs the authentic Joel Califa multiplayer cursor fleet. It snapshots the live Krynara-OS DOM into wireframes, typed headers, ⌥-drag duplicates with distance measurements, red guide lines with snapping, and spatial Web Audio piano notes.
        </p>

        {/* Live Telemetry Strip */}
        <div className="swarm-telemetry-strip">
          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">FLEET STATUS</span>
            <div className="swarm-telemetry-val">
              <span className={`status-dot${telemetry.complete ? '' : ' status-dot-offline'}`} />
              <strong>{telemetry.complete ? 'PAGE LIVE / NOMINAL' : 'REBUILDING VIEW'}</strong>
            </div>
          </div>

          <div className="swarm-telemetry-item">
            <span className="swarm-telemetry-label">ONLINE WORKERS</span>
            <div className="swarm-telemetry-val">
              <span>{telemetry.workers} AGENTS</span>
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
          {/* Master Triggers */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>ACTIVE REBUILD ACTIONS</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className="swarm-btn"
                style={{ borderColor: 'var(--krynara-cyan)', color: 'var(--krynara-cyan)', fontWeight: 700 }}
                onClick={triggerRebuild}
              >
                ⚡ TRIGGER FULL VIEW REBUILD
              </button>
              <button
                type="button"
                className="swarm-btn"
                onClick={triggerGoLive}
              >
                GO LIVE (FADE TO PAGE)
              </button>
              <button
                type="button"
                className={`swarm-btn${telemetry.tour ? ' active' : ''}`}
                onClick={toggleTour}
              >
                {telemetry.tour ? 'AUTO-TOUR ACTIVE' : 'START TOUR MODE'}
              </button>
            </div>
          </div>

          {/* Speed Selection */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>BUILD VELOCITY</span>
            </div>
            <div className="swarm-button-group">
              {[1, 2, 3].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`swarm-btn${telemetry.speed === s ? ' active' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}× SPEED
                </button>
              ))}
            </div>
          </div>

          {/* Sound Controls */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>PROCEDURAL WEB AUDIO (E PENTATONIC)</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${telemetry.sound ? ' active' : ''}`}
                onClick={() => setSound(!telemetry.sound)}
              >
                {telemetry.sound ? '🔊 SOUND ON' : '🔇 SOUND MUTED'}
              </button>
            </div>
          </div>

          {/* Automation Toggles */}
          <div className="swarm-control-box">
            <div className="swarm-control-head">
              <span>AUTOMATION TRIGGERS</span>
            </div>
            <div className="swarm-button-group">
              <button
                type="button"
                className={`swarm-btn${autoNav ? ' active' : ''}`}
                onClick={toggleAutoNav}
              >
                BUILD ON ROUTE CHANGE {autoNav ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${autoTouch ? ' active' : ''}`}
                onClick={toggleAutoTouch}
              >
                BUILD ON TOUCH / CLICK {autoTouch ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`swarm-btn${showFloatingHud ? ' active' : ''}`}
                onClick={toggleFloatingHud}
              >
                BOTTOM HUD BAR {showFloatingHud ? 'ALWAYS VISIBLE' : 'ONLY IN SETTINGS'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </HudFrame>
  );
}
