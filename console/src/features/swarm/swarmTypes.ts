export type CursorShape =
  | 'arrow'
  | 'dup'
  | 'pen'
  | 'pen-add'
  | 'pen-close'
  | 'cross'
  | 'ibeam'
  | 'ew'
  | 'ns';

export interface CursorAgent {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  shape: CursorShape;
  press: number;
  speed: number;
  force: number;
  spin: number;
  curl: number;
  orbit: number;
  follow: boolean;
  sticky: boolean;
  leaving: boolean;
  idleFor: number;
  task: SwarmTask | null;
  gen: Generator<void, void, unknown> | null;
  ov: (() => OverlayDraw[]) | null;
}

export type TaskKind = 'rect' | 'text' | 'line' | 'guide' | 'dup' | 'media';

export interface SwarmTask {
  id: string;
  kind: TaskKind;
  targetElement?: HTMLElement | null;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  pts?: Array<{ x: number; y: number }>;
  srcBox?: { x: number; y: number; w: number; h: number };
  guideAxis?: 'x' | 'y';
  grow?: boolean;
  state: 'wait' | 'active' | 'done';
  doneAt?: number;
  deps: SwarmTask[];
  gate: number;
  progress: number;
}

export interface OverlayBox {
  t: 'box';
  b: { x: number; y: number; w: number; h: number };
  color?: 'blue' | 'red' | 'cyan';
  handles?: boolean;
  badge?: string;
  rulerLines?: boolean;
  underline?: { x: number; y: number; w: number; h: number };
}

export interface OverlayMeasure {
  t: 'measure';
  a: { x: number; y: number };
  b: { x: number; y: number };
  label: string;
}

export type OverlayDraw = OverlayBox | OverlayMeasure;

export interface GuideLine {
  id: string;
  axis: 'x' | 'y';
  cur: number;
  target: number;
  vis: boolean;
  op: number;
  flash: number;
  shownAt?: number;
  dragging?: boolean;
}

export interface SwarmArrowCustomization {
  enabled: boolean;
  speed: number;
  agentCount: number;
  colorTheme: 'cyan' | 'matrix' | 'amber' | 'multi' | 'monochrome';
  arrowHeadTheme: 'default' | 'shooting-stars';
  showTags: boolean;
  arrowGlow: boolean;
  arrowScale: number;
  soundEnabled: boolean;
  soundVolume: number;
  autoNav: boolean;
  autoScroll: boolean;
  autoTouch: boolean;
  showFloatingHud: boolean;
}

export interface SwarmConfig extends SwarmArrowCustomization {
  volume: number;
  minAgents: number;
  maxAgents: number;
}

export interface SwarmTelemetry {
  online: boolean;
  state: 'INITIALIZING' | 'IDLE' | 'BUILDING' | 'FLOCKING' | 'PAUSED';
  activeAgents: number;
  totalAgents: number;
  layersBuilt: number;
  totalLayers: number;
  backlog: number;
  tourActive: boolean;
  activeTasks: Array<{ cursorName: string; cursorColor: string; description: string }>;
}
