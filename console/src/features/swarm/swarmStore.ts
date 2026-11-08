import type { SwarmConfig, SwarmTelemetry } from './swarmTypes';
import { swarmSound } from './swarmSound';

const DEFAULT_CONFIG: SwarmConfig = {
  enabled: true,
  buildOnTouch: true,
  buildOnScroll: true,
  soundEnabled: true,
  volume: 0.8,
  speed: 1,
  minAgents: 8,
  maxAgents: 32,
};

function loadStoredConfig(): SwarmConfig {
  try {
    const raw = localStorage.getItem('krynara_swarm_config');
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CONFIG;
}

type Listener = () => void;

class SwarmStore {
  private config: SwarmConfig = loadStoredConfig();
  private telemetry: SwarmTelemetry = {
    online: true,
    state: 'INITIALIZING',
    activeAgents: 8,
    totalAgents: 18,
    layersBuilt: 0,
    totalLayers: 0,
    backlog: 0,
    tourActive: false,
    activeTasks: [],
  };
  private listeners = new Set<Listener>();

  public getConfig(): SwarmConfig {
    return this.config;
  }

  public getTelemetry(): SwarmTelemetry {
    return this.telemetry;
  }

  public updateConfig(patch: Partial<SwarmConfig>) {
    this.config = { ...this.config, ...patch };
    try {
      localStorage.setItem('krynara_swarm_config', JSON.stringify(this.config));
    } catch {
      // ignore
    }
    if (patch.soundEnabled !== undefined) {
      swarmSound.setOn(patch.soundEnabled);
    }
    if (patch.volume !== undefined) {
      swarmSound.setVolume(patch.volume);
    }
    this.emit();
  }

  public updateTelemetry(patch: Partial<SwarmTelemetry>) {
    this.telemetry = { ...this.telemetry, ...patch };
    this.emit();
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) {
      fn();
    }
  }

  // Trigger events for the engine
  public triggerManualRebuild() {
    window.dispatchEvent(new CustomEvent('krynara:swarm:rebuild'));
  }

  public toggleTour() {
    window.dispatchEvent(new CustomEvent('krynara:swarm:toggle-tour'));
  }

  public triggerFlockToCursor() {
    window.dispatchEvent(new CustomEvent('krynara:swarm:flock-mouse'));
  }
}

export const swarmStore = new SwarmStore();

