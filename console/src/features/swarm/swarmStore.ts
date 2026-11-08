import type { SwarmArrowCustomization, SwarmTelemetry } from './swarmTypes';
import { swarmSound } from './swarmSound';

export const DEFAULT_SWARM_CUSTOMIZATION: SwarmArrowCustomization = {
  enabled: true,
  speed: 2,
  agentCount: 18,
  colorTheme: 'cyan',
  showTags: true,
  arrowGlow: true,
  arrowScale: 1.0,
  soundEnabled: true,
  soundVolume: 0.8,
  autoNav: true,
  autoScroll: true,
  autoTouch: false,
  showFloatingHud: false,
};

function loadStoredConfig(): SwarmArrowCustomization {
  try {
    const raw = localStorage.getItem('krynara_swarm_customization');
    if (raw) {
      return { ...DEFAULT_SWARM_CUSTOMIZATION, ...JSON.parse(raw) };
    }
    // Backward compatibility with individual legacy keys
    return {
      ...DEFAULT_SWARM_CUSTOMIZATION,
      enabled: localStorage.getItem('krynara_swarm_enabled') !== 'false',
      autoNav: localStorage.getItem('krynara_swarm_auto_nav') !== 'false',
      autoScroll: localStorage.getItem('krynara_swarm_auto_scroll') !== 'false',
      autoTouch: localStorage.getItem('krynara_swarm_auto_touch') === 'true',
      showFloatingHud: localStorage.getItem('krynara_swarm_show_floating_hud') === 'true',
    };
  } catch {
    // ignore
  }
  return DEFAULT_SWARM_CUSTOMIZATION;
}

type Listener = () => void;

class SwarmStore {
  private config: SwarmArrowCustomization = loadStoredConfig();
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

  public getConfig(): SwarmArrowCustomization {
    return this.config;
  }

  public getTelemetry(): SwarmTelemetry {
    return this.telemetry;
  }

  public updateConfig(patch: Partial<SwarmArrowCustomization>) {
    this.config = { ...this.config, ...patch };
    try {
      localStorage.setItem('krynara_swarm_customization', JSON.stringify(this.config));
      // Sync legacy keys
      if (patch.enabled !== undefined) localStorage.setItem('krynara_swarm_enabled', String(patch.enabled));
      if (patch.autoNav !== undefined) localStorage.setItem('krynara_swarm_auto_nav', String(patch.autoNav));
      if (patch.autoScroll !== undefined) localStorage.setItem('krynara_swarm_auto_scroll', String(patch.autoScroll));
      if (patch.autoTouch !== undefined) localStorage.setItem('krynara_swarm_auto_touch', String(patch.autoTouch));
      if (patch.showFloatingHud !== undefined) localStorage.setItem('krynara_swarm_show_floating_hud', String(patch.showFloatingHud));
      if (patch.speed !== undefined) localStorage.setItem('krynara_swarm_speed', String(patch.speed));
      if (patch.soundEnabled !== undefined) localStorage.setItem('krynara_swarm_sound', String(patch.soundEnabled));
    } catch {
      // ignore
    }
    if (patch.soundEnabled !== undefined) {
      swarmSound.setOn(patch.soundEnabled);
    }
    if (patch.soundVolume !== undefined) {
      swarmSound.setVolume(patch.soundVolume);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('krynara:swarm:config-change', { detail: this.config }));
      if (window.__swarmRebuild?.updateConfig) {
        window.__swarmRebuild.updateConfig(this.config as unknown as Record<string, unknown>);
      }
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

  public triggerManualRebuild() {
    if (typeof window !== 'undefined' && window.__swarmRebuild) {
      window.__swarmRebuild.restart();
    }
  }

  public toggleTour() {
    if (typeof window !== 'undefined' && window.__swarmRebuild) {
      window.__swarmRebuild.toggleTour();
    }
  }

  public resetDefaults() {
    this.updateConfig(DEFAULT_SWARM_CUSTOMIZATION);
  }
}

export const swarmStore = new SwarmStore();

