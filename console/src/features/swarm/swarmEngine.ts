import type {
  CursorAgent,
  CursorShape,
  GuideLine,
  OverlayDraw,
  SwarmTask,
} from './swarmTypes';
import { swarmSound } from './swarmSound';
import { swarmStore } from './swarmStore';

const NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Ken', 'Barbara', 'Dennis',
  'Radia', 'Guido', 'Frances', 'Bjarne', 'Hedy', 'Tim', 'Katherine', 'Edsger',
  'Joan', 'Donald', 'Sophie', 'Niklaus', 'Anita', 'Brian', 'Mary', 'Rob',
  'Ida', 'Yukihiro', 'Shafi', 'Leslie', 'Jean', 'Vint', 'Lynn', 'Bram',
];

const COLORS = [
  '#8AF8FF', '#00FF9C', '#FFC857', '#FF5F6D', '#0D99FF', '#A259FF',
  '#FF7262', '#14AE5C', '#00B5CE', '#FF8A00', '#E8467C', '#1ABCFE',
];

const BLUE = '#0D99FF';
const RED = '#FF5F6D';
const CYAN = '#8AF8FF';

const ARROW_D =
  'M4.6 3.9 C4.2 3.1 4.9 2.4 5.7 2.8 L20.6 9.4 C21.5 9.8 21.4 11.1 20.4 11.3 L13.9 12.9 C13.4 13 13 13.4 12.9 13.9 L11.3 20.4 C11.1 21.4 9.8 21.5 9.4 20.6 Z';

const HOT: Record<CursorShape, [number, number]> = {
  arrow: [5, 3.5],
  dup: [5, 3.5],
  pen: [3, 3],
  'pen-add': [3, 3],
  'pen-close': [3, 3],
  cross: [12, 12],
  ibeam: [12, 12],
  ew: [12, 12],
  ns: [12, 12],
};

function cursorSVG(shape: CursorShape, color: string): string {
  const st = 'stroke="#fff" stroke-width="1.5" stroke-linejoin="round"';
  switch (shape) {
    case 'arrow':
      return `<path d="${ARROW_D}" fill="${color}" ${st}/>`;
    case 'dup':
      return (
        `<path d="${ARROW_D}" transform="translate(4 3.5)" fill="#fff" stroke="${color}" stroke-width="1.3" stroke-linejoin="round"/>` +
        `<path d="${ARROW_D}" fill="${color}" ${st}/>`
      );
    case 'pen':
    case 'pen-add':
    case 'pen-close': {
      let s =
        `<path d="M17.4 10.6 L20.6 13.8 L13.8 20.6 L10.6 17.4 Z" fill="${color}" ${st}/>` +
        `<path d="M3 3 L13.1 6.3 L17.4 10.6 L10.6 17.4 L6.3 13.1 Z" fill="${color}" ${st}/>` +
        `<path d="M3.6 3.6 L8.9 8.9" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>` +
        `<circle cx="10.2" cy="10.2" r="1.75" fill="none" stroke="#fff" stroke-width="1.2"/>`;
      if (shape === 'pen-add')
        s +=
          `<g stroke-linecap="round"><path d="M23 19.5 V26.5 M19.5 23 H26.5" stroke="#fff" stroke-width="3.4"/>` +
          `<path d="M23 19.5 V26.5 M19.5 23 H26.5" stroke="#1E1E1E" stroke-width="1.3"/></g>`;
      if (shape === 'pen-close')
        s +=
          `<circle cx="23" cy="23" r="2.8" fill="none" stroke="#fff" stroke-width="3.2"/>` +
          `<circle cx="23" cy="23" r="2.8" fill="none" stroke="#1E1E1E" stroke-width="1.2"/>`;
      return s;
    }
    case 'cross':
      return (
        `<path d="M12 2 V22 M2 12 H22" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>` +
        `<path d="M12 2 V22 M2 12 H22" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`
      );
    case 'ibeam':
      return (
        `<path d="M8 4 H16 M12 4 V20 M8 20 H16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>` +
        `<path d="M8 4 H16 M12 4 V20 M8 20 H16" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`
      );
    case 'ew':
      return `<path d="M2 12 L7 7 V11 H17 V7 L22 12 L17 17 V13 H7 V17 Z" fill="${color}" ${st}/>`;
    case 'ns':
      return `<path d="M12 2 L7 7 H11 V17 H7 L12 22 L17 17 H13 V7 H17 Z" fill="${color}" ${st}/>`;
    default:
      return `<path d="${ARROW_D}" fill="${color}" ${st}/>`;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const f1 = (n: number) => Math.round(n * 10) / 10;

export class SwarmEngine {
  private cursorsEl: HTMLElement | null = null;
  private ovSvg: SVGSVGElement | null = null;
  private badgesEl: HTMLElement | null = null;
  private cursorEls = new Map<number, HTMLElement>();

  public cursors: CursorAgent[] = [];
  public tasks: SwarmTask[] = [];
  public guides: GuideLine[] = [];
  public editLines = new Set<{ pts: Array<{ x: number; y: number }>; placed: number; owner?: CursorAgent | null }>();

  private rafId: number | null = null;
  private lastT: number | null = null;
  private nextId = 0;
  private mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private flockToMouse = false;
  private tourActive = false;
  private touchedCooldown = new WeakSet<HTMLElement>();

  private totalLayers = 0;
  private layersBuilt = 0;
  private tempo = 3.2;

  constructor() {
    this.initAgents(22);
  }

  public mount(
    _container: HTMLElement,
    cursorsEl: HTMLElement,
    ovSvg: SVGSVGElement,
    badgesEl: HTMLElement,
    _rulersEl: HTMLElement,
  ) {
    this.cursorsEl = cursorsEl;
    this.ovSvg = ovSvg;
    this.badgesEl = badgesEl;

    this.attachEventListeners();
    this.startLoop();

    // Fast initial scan of UI elements
    setTimeout(() => {
      this.scanAndQueueVisible();
    }, 250);
  }

  public unmount() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.cursorEls.clear();
    this.removeEventListeners();
  }

  private initAgents(count: number) {
    this.cursors = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0;
      const x = side ? -40 - rand(0, 100) : vw + 40 + rand(0, 100);
      const y = rand(0.1, 0.9) * vh;
      this.cursors.push(this.makeCursor(x, y));
    }
  }

  private makeCursor(x: number, y: number): CursorAgent {
    const id = this.nextId++;
    const fast = Math.random() < 0.35;
    return {
      id,
      name: NAMES[id % NAMES.length],
      color: COLORS[id % COLORS.length],
      x,
      y,
      vx: 0,
      vy: 0,
      angle: 0,
      shape: 'arrow',
      press: 0,
      speed: fast ? rand(1100, 1700) : rand(600, 1100),
      force: fast ? rand(4000, 6500) : rand(1800, 3200),
      spin: fast ? rand(2.2, 3.4) : rand(0.8, 1.8),
      curl: rand(-1, 1),
      orbit: rand(60, 160),
      follow: true,
      sticky: true,
      leaving: false,
      idleFor: 0,
      task: null,
      gen: null,
      ov: null,
    };
  }

  private attachEventListeners() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true, capture: true });
    window.addEventListener('krynara:swarm:rebuild', this.onManualRebuild);
    window.addEventListener('krynara:swarm:toggle-tour', this.onToggleTour);
    window.addEventListener('krynara:swarm:flock-mouse', this.onFlockMouse);
  }

  private removeEventListeners() {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('krynara:swarm:rebuild', this.onManualRebuild);
    window.removeEventListener('krynara:swarm:toggle-tour', this.onToggleTour);
    window.removeEventListener('krynara:swarm:flock-mouse', this.onFlockMouse);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.mousePos.x = e.clientX;
    this.mousePos.y = e.clientY;
  };

  private onPointerDown = (e: PointerEvent) => {
    swarmSound.init();
    swarmSound.press(e.clientX, window.innerWidth);

    const config = swarmStore.getConfig();
    if (!config.enabled || !config.buildOnTouch) return;

    let target = e.target as HTMLElement | null;
    while (target && target !== document.body) {
      if (
        target.matches(
          '.hud-frame, .hud-button, button, a, .device-tab, .krynara-nav a, .card, input, select, textarea, .settings-key, .time-city-card, .gauge-circle',
        )
      ) {
        if (!this.touchedCooldown.has(target)) {
          this.touchedCooldown.add(target);
          setTimeout(() => this.touchedCooldown.delete(target!), 1500);
          this.decomposeAndQueueElement(target);
        }
        break;
      }
      target = target.parentElement;
    }
  };

  private onScroll = () => {
    const config = swarmStore.getConfig();
    if (!config.enabled || !config.buildOnScroll) return;
    this.scanAndQueueVisible();
  };

  private onManualRebuild = () => {
    this.triggerFullRebuild();
  };

  private onToggleTour = () => {
    this.tourActive = !this.tourActive;
    swarmStore.updateTelemetry({ tourActive: this.tourActive });
  };

  private onFlockMouse = () => {
    this.flockToMouse = !this.flockToMouse;
  };

  // Decompose an element into multiple concurrent tasks (box, heading, buttons, lines, guide)
  // This causes 5-15 agents to swoop in and build concurrently at high speed!
  public decomposeAndQueueElement(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) return;

    const newTasks: SwarmTask[] = [];

    // 1. The main frame rect
    const mainBoxTask: SwarmTask = {
      id: `task-box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'rect',
      targetElement: el,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      state: 'wait',
      deps: [],
      gate: 0,
      progress: 0,
    };
    newTasks.push(mainBoxTask);

    // 2. Child headings or title text (growable text)
    const titles = el.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, .hud-corner-title, .krynara-heading, strong, .hud-value',
    );
    for (const title of titles) {
      const tr = title.getBoundingClientRect();
      if (tr.width > 10 && tr.height > 8) {
        const text = title.innerText?.trim();
        if (text) {
          const fontSize = parseFloat(window.getComputedStyle(title).fontSize) || 16;
          newTasks.push({
            id: `task-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'text',
            targetElement: title,
            x: tr.left,
            y: tr.top,
            w: tr.width,
            h: tr.height,
            text,
            fontSize,
            grow: fontSize > 20,
            state: 'wait',
            deps: [mainBoxTask],
            gate: 0,
            progress: 0,
          });
        }
      }
    }

    // 3. Child buttons or action cards (can be drawn or duplicated)
    const buttons = el.querySelectorAll<HTMLElement>('.hud-button, button, a, .device-tab, .card, .tag');
    let lastBtnRect: { x: number; y: number; w: number; h: number } | null = null;
    let btnCount = 0;

    for (const btn of buttons) {
      if (btnCount > 6) break; // keep reasonable cap
      const br = btn.getBoundingClientRect();
      if (br.width > 12 && br.height > 10) {
        if (lastBtnRect && Math.random() < 0.5) {
          // ⌥-drag Duplicate task!
          newTasks.push({
            id: `task-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'dup',
            targetElement: btn,
            x: br.left,
            y: br.top,
            w: br.width,
            h: br.height,
            srcBox: lastBtnRect,
            state: 'wait',
            deps: [mainBoxTask],
            gate: 0,
            progress: 0,
          });
        } else {
          newTasks.push({
            id: `task-btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'rect',
            targetElement: btn,
            x: br.left,
            y: br.top,
            w: br.width,
            h: br.height,
            text: btn.innerText?.slice(0, 20),
            state: 'wait',
            deps: [mainBoxTask],
            gate: 0,
            progress: 0,
          });
          lastBtnRect = { x: br.left, y: br.top, w: br.width, h: br.height };
        }
        btnCount++;
      }
    }

    // 4. Divider lines or borders
    if (rect.width > 200 && Math.random() < 0.6) {
      newTasks.push({
        id: `task-line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'line',
        x: rect.left + 14,
        y: rect.top + 32,
        w: rect.width - 28,
        h: 2,
        pts: [
          { x: rect.left + 14, y: rect.top + 32 },
          { x: rect.left + rect.width - 14, y: rect.top + 32 },
        ],
        state: 'wait',
        deps: [mainBoxTask],
        gate: 0,
        progress: 0,
      });
    }

    // 5. Red alignment laser guide
    if (Math.random() < 0.45) {
      newTasks.push({
        id: `task-guide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'guide',
        x: rect.left,
        y: rect.top,
        w: 1,
        h: 1,
        guideAxis: Math.random() < 0.5 ? 'x' : 'y',
        state: 'wait',
        deps: [],
        gate: 0,
        progress: 0,
      });
    }

    // Push all new tasks to queue
    for (const t of newTasks) {
      this.tasks.push(t);
      this.totalLayers++;
    }
  }

  private scanAndQueueVisible() {
    const config = swarmStore.getConfig();
    if (!config.enabled) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates = document.querySelectorAll<HTMLElement>(
      '.hud-frame, .hud-button, .card, .settings-key, .time-city-card, .weather-current, .krynara-row, .device-tab, .krynara-brand',
    );

    for (const el of candidates) {
      if (this.touchedCooldown.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0) {
        this.touchedCooldown.add(el);
        this.decomposeAndQueueElement(el);
      }
    }
  }

  public triggerFullRebuild() {
    this.tasks = [];
    this.layersBuilt = 0;
    this.totalLayers = 0;
    this.guides = [];
    this.editLines.clear();

    swarmSound.init();
    swarmSound.startFan();

    // Spawn 2 initial laser guides
    this.guides.push({
      id: 'g-top',
      axis: 'y',
      cur: 76,
      target: 76,
      vis: true,
      op: 0.9,
      flash: 1,
    });
    this.guides.push({
      id: 'g-left',
      axis: 'x',
      cur: 260,
      target: 260,
      vis: true,
      op: 0.9,
      flash: 1,
    });
    swarmSound.snap(260, window.innerWidth);

    // Orbit all cursors around center
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    for (const c of this.cursors) {
      c.task = null;
      c.gen = null;
      c.follow = true;
      c.shape = 'arrow';
      c.x = cx + Math.cos(c.id) * 120;
      c.y = cy + Math.sin(c.id) * 120;
    }

    setTimeout(() => {
      this.scanAndQueueVisible();
    }, 400);
  }

  // ------------------------------------------------ Generator Primitives

  private *wait(t: number): Generator<void, void, number> {
    let n = 0;
    while (n < t) {
      const dt: number = (yield) || 0.016;
      n += dt * this.tempo;
    }
  }

  private *moveTo(
    c: CursorAgent,
    target: { x: number; y: number },
    o: { speed?: number; drag?: boolean; bend?: number; onStep?: () => void } = {},
  ): Generator<void, void, number> {
    const x0 = c.x;
    const y0 = c.y;
    const dist = Math.hypot(target.x - x0, target.y - y0);
    if (dist < 1) {
      c.x = target.x;
      c.y = target.y;
      if (o.onStep) o.onStep();
      return;
    }

    // High agility: brisk duration between 0.08s and 0.38s
    const dur = clamp(0.08 + Math.sqrt(dist) * 0.015, 0.09, 0.38) / (o.speed || 1);
    const bend = (o.bend != null ? o.bend : (Math.random() < 0.5 ? -1 : 1) * rand(0.04, 0.12)) * Math.min(dist, 400);
    let elapsed = 0;

    while (elapsed < dur) {
      const dt: number = (yield) || 0.016;
      elapsed += dt * this.tempo;
      const k = Math.min(1, elapsed / dur);
      const e = o.drag || k < 0.15 ? easeInOut(k) : easeOut(k);
      const dx = target.x - x0;
      const dy = target.y - y0;
      const L = Math.hypot(dx, dy) || 1;
      const off = Math.sin(Math.PI * e) * bend;

      c.x = x0 + dx * e + (-dy / L) * off;
      c.y = y0 + dy * e + (dx / L) * off;

      if (dx !== 0 || dy !== 0) {
        c.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      if (o.onStep) o.onStep();
    }

    c.x = target.x;
    c.y = target.y;
    if (o.onStep) o.onStep();
  }

  private *click(c: CursorAgent): Generator<void, void, number> {
    c.press = 1;
    swarmSound.press(c.x, window.innerWidth);
    yield* this.wait(0.05);
    c.press = 0;
  }

  // Rapid mechanical character typing roll
  private *type(c: CursorAgent, text: string): Generator<void, void, number> {
    const N = text.length;
    let budget = 0;
    let i = 0;
    while (i < N) {
      const dt: number = (yield) || 0.016;
      budget += dt * this.tempo;
      const prev = i;
      while (i < N && budget > 0) {
        const ch = text[i];
        let d = rand(0.015, 0.035);
        if (ch === ' ') d += rand(0.01, 0.03);
        if (ch === '\n') d += 0.06;
        budget -= d;
        i++;
      }
      if (i > prev) {
        const isSpace = text.slice(prev, i).includes(' ');
        swarmSound.key(c.x, window.innerWidth, c.id, i - prev, isSpace ? 1 : 0);
      }
    }
  }

  // ------------------------------------------------ Task Choreographies

  private *drawBox(c: CursorAgent, t: SwarmTask): Generator<void, void, number> {
    c.shape = 'cross';
    yield* this.moveTo(c, { x: t.x, y: t.y }, { speed: 1.2 });
    yield* this.click(c);
    c.press = 1;

    const ghost = { x: t.x, y: t.y, w: 0, h: 0 };
    c.ov = () => [
      {
        t: 'box',
        b: ghost,
        color: 'blue',
        handles: true,
        badge: `${Math.round(ghost.w)} × ${Math.round(ghost.h)}`,
        rulerLines: true,
      },
    ];

    yield* this.moveTo(
      c,
      { x: t.x + t.w, y: t.y + t.h },
      {
        speed: 0.95,
        drag: true,
        bend: 0,
        onStep: () => {
          ghost.w = Math.max(0, c.x - t.x);
          ghost.h = Math.max(0, c.y - t.y);
        },
      },
    );

    c.press = 0;
    c.shape = 'arrow';
    yield* this.wait(0.08);

    swarmSound.place('rect', t.x, t.y, t.w, t.h, window.innerWidth, window.innerHeight);
    yield* this.wait(0.12);
    c.ov = null;
  }

  private *drawText(c: CursorAgent, t: SwarmTask, grow = false): Generator<void, void, number> {
    c.shape = 'cross';
    yield* this.moveTo(c, { x: t.x, y: t.y }, { speed: 1.3 });

    const ghost = { x: t.x, y: t.y, w: 0, h: 0 };
    c.ov = () => [
      {
        t: 'box',
        b: ghost,
        color: 'cyan',
        handles: true,
        badge: `${Math.round(ghost.w)} × ${Math.round(ghost.h)}`,
      },
    ];

    yield* this.moveTo(
      c,
      { x: t.x + t.w, y: t.y + Math.min(32, t.h) },
      {
        speed: 1.1,
        drag: true,
        onStep: () => {
          ghost.w = Math.max(0, c.x - t.x);
          ghost.h = Math.max(0, c.y - t.y);
        },
      },
    );

    c.shape = 'ibeam';
    c.ov = () => [{ t: 'box', b: { x: t.x, y: t.y, w: t.w, h: t.h }, color: 'cyan' }];
    yield* this.moveTo(c, { x: t.x + rand(10, 30), y: t.y + 12 }, { speed: 1.5 });

    yield* this.type(c, t.text || 'KRYNARA // OS');
    yield* this.wait(0.06);

    // Font size grow run for big headings
    if (grow && t.fontSize && t.fontSize > 20) {
      const steps = [24, 32, 40, 48, 56, 72].filter((s) => s <= t.fontSize!);
      let k = 0;
      for (const _s of steps) {
        yield* this.wait(0.04);
        swarmSound.grow(k++, c.x, window.innerWidth);
      }
    }

    c.shape = 'arrow';
    yield* this.wait(0.08);
    c.ov = null;
  }

  private *drawLine(c: CursorAgent, t: SwarmTask): Generator<void, void, number> {
    if (!t.pts || t.pts.length < 2) return;
    c.shape = 'pen-add';
    yield* this.moveTo(c, t.pts[0], { speed: 1.4 });
    yield* this.click(c);

    const lineObj: { pts: Array<{ x: number; y: number }>; placed: number; owner: CursorAgent | null } = {
      pts: t.pts,
      placed: 1,
      owner: c,
    };
    this.editLines.add(lineObj);
    c.shape = 'pen';

    for (let i = 1; i < t.pts.length; i++) {
      yield* this.moveTo(c, t.pts[i], { speed: 1.2 });
      yield* this.click(c);
      lineObj.placed = i + 1;
      yield* this.wait(0.04);
    }

    lineObj.owner = null;
    yield* this.wait(0.1);
    this.editLines.delete(lineObj);
    c.shape = 'arrow';
  }

  private *dragGuide(c: CursorAgent, t: SwarmTask): Generator<void, void, number> {
    const axis = t.guideAxis || 'y';
    const marginPos = axis === 'x' ? { x: 12, y: t.y } : { x: t.x, y: 12 };

    c.shape = 'arrow';
    yield* this.moveTo(c, marginPos, { speed: 1.4 });
    yield* this.click(c);

    c.press = 1;
    c.shape = axis === 'x' ? 'ew' : 'ns';

    const guide: GuideLine = {
      id: `g-${Date.now()}`,
      axis,
      cur: axis === 'x' ? 12 : 12,
      target: axis === 'x' ? t.x : t.y,
      vis: true,
      op: 1,
      flash: 1,
      dragging: true,
    };
    this.guides.push(guide);

    const targetPos = axis === 'x' ? { x: t.x, y: t.y + 20 } : { x: t.x + 20, y: t.y };
    yield* this.moveTo(c, targetPos, {
      speed: 0.9,
      drag: true,
      onStep: () => {
        guide.cur = axis === 'x' ? c.x : c.y;
      },
    });

    guide.cur = guide.target;
    guide.dragging = false;
    c.press = 0;
    c.shape = 'arrow';
    swarmSound.snap(c.x, window.innerWidth);
    yield* this.wait(0.15);
  }

  private *duplicate(c: CursorAgent, t: SwarmTask): Generator<void, void, number> {
    if (!t.srcBox) return;
    const sb = t.srcBox;
    const db = { x: t.x, y: t.y, w: t.w, h: t.h };

    c.shape = 'arrow';
    yield* this.moveTo(c, { x: sb.x + sb.w * 0.5, y: sb.y + sb.h * 0.5 }, { speed: 1.3 });
    yield* this.click(c);

    c.ov = () => [{ t: 'box', b: sb, handles: true, badge: `${Math.round(sb.w)} × ${Math.round(sb.h)}` }];
    yield* this.wait(0.1);

    c.shape = 'dup';
    c.press = 1;

    const movingBox = { ...sb };
    const dx = db.x - sb.x;
    const dy = db.y - sb.y;
    const gap = Math.round(Math.hypot(dx, dy));

    c.ov = () => [
      { t: 'box', b: sb, color: 'red' },
      { t: 'box', b: movingBox, color: 'red' },
      {
        t: 'measure',
        a: { x: sb.x + sb.w, y: sb.y + sb.h / 2 },
        b: { x: movingBox.x, y: movingBox.y + movingBox.h / 2 },
        label: `${gap}px`,
      },
    ];

    yield* this.moveTo(c, { x: db.x + db.w * 0.5, y: db.y + db.h * 0.5 }, {
      speed: 0.85,
      drag: true,
      onStep: () => {
        movingBox.x = c.x - db.w * 0.5;
        movingBox.y = c.y - db.h * 0.5;
      },
    });

    c.press = 0;
    c.shape = 'arrow';
    swarmSound.place('dup', db.x, db.y, db.w, db.h, window.innerWidth, window.innerHeight);
    yield* this.wait(0.12);
    c.ov = null;
  }

  private assignTask(c: CursorAgent, t: SwarmTask) {
    c.task = t;
    t.state = 'active';
    c.follow = false;

    switch (t.kind) {
      case 'rect':
        c.gen = this.drawBox(c, t) as Generator<void, void, unknown>;
        break;
      case 'text':
        c.gen = this.drawText(c, t, t.grow) as Generator<void, void, unknown>;
        break;
      case 'line':
        c.gen = this.drawLine(c, t) as Generator<void, void, unknown>;
        break;
      case 'guide':
        c.gen = this.dragGuide(c, t) as Generator<void, void, unknown>;
        break;
      case 'dup':
        c.gen = this.duplicate(c, t) as Generator<void, void, unknown>;
        break;
      default:
        c.gen = this.drawBox(c, t) as Generator<void, void, unknown>;
    }
  }

  private startLoop() {
    const loop = (t: number) => {
      if (this.lastT == null) this.lastT = t;
      const dt = Math.min((t - this.lastT) / 1000, 0.05);
      this.lastT = t;

      this.step(dt);
      this.render();

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private step(dt: number) {
    const config = swarmStore.getConfig();
    if (!config.enabled) return;

    // Swift tempo calculation from swarm.js
    this.tempo = clamp(2.8 + (this.tasks.length / Math.max(1, this.cursors.length)) * 0.9, 2.8, 6.5) * config.speed;

    // Tour auto-scrolling
    if (this.tourActive) {
      const mainEl = document.querySelector('.krynara-main') || window;
      if (mainEl === window) {
        window.scrollBy(0, 180 * dt * config.speed);
      } else {
        (mainEl as HTMLElement).scrollTop += 180 * dt * config.speed;
      }
    }

    // Dynamic agent scaling based on backlog
    const backlog = this.tasks.filter((t) => t.state !== 'done').length;
    const targetAgents = clamp(
      config.minAgents + Math.floor(backlog * 0.6),
      config.minAgents,
      config.maxAgents,
    );

    while (this.cursors.length < targetAgents) {
      const side = Math.random() < 0.5;
      const x = side ? -20 : window.innerWidth + 20;
      const y = rand(0.1, 0.9) * window.innerHeight;
      this.cursors.push(this.makeCursor(x, y));
    }
    while (this.cursors.length > targetAgents && this.cursors.some((c) => !c.task)) {
      const idleIdx = this.cursors.findIndex((c) => !c.task);
      if (idleIdx !== -1) {
        const removed = this.cursors.splice(idleIdx, 1)[0];
        const el = this.cursorEls.get(removed.id);
        if (el) {
          el.remove();
          this.cursorEls.delete(removed.id);
        }
      }
    }

    // Assign waiting tasks to ALL available idle cursors simultaneously
    for (const c of this.cursors) {
      if (!c.task) {
        const availableIdx = this.tasks.findIndex(
          (t) => t.state === 'wait' && t.deps.every((d) => d.state === 'done'),
        );
        if (availableIdx !== -1) {
          const nextTask = this.tasks[availableIdx];
          this.assignTask(c, nextTask);
        }
      }
    }

    // Step every cursor generator with dt
    for (const c of this.cursors) {
      if (c.gen) {
        const res = c.gen.next(dt as unknown as void);
        if (res.done) {
          if (c.task) {
            c.task.state = 'done';
            c.task.doneAt = performance.now();
            this.layersBuilt++;
            c.task = null;
          }
          c.gen = null;
          c.follow = true;
          c.ov = null;
          c.shape = 'arrow';
        }
      } else if (c.follow) {
        // Fluid boids / idle flocking
        const cx = this.flockToMouse ? this.mousePos.x : window.innerWidth / 2;
        const cy = this.flockToMouse ? this.mousePos.y : window.innerHeight / 2;
        const dx = cx - c.x;
        const dy = cy - c.y;
        const dist = Math.hypot(dx, dy) || 1;

        if (this.flockToMouse) {
          c.vx += (dx / dist) * c.speed * dt * 2.8;
          c.vy += (dy / dist) * c.speed * dt * 2.8;
        } else {
          const angle = Math.atan2(dy, dx) + c.curl * 0.55;
          const targetX = cx + Math.cos(angle + c.orbit * 0.01) * c.orbit;
          const targetY = cy + Math.sin(angle + c.orbit * 0.01) * c.orbit;

          c.vx += ((targetX - c.x) * 1.8 - c.vx * 0.6) * dt;
          c.vy += ((targetY - c.y) * 1.8 - c.vy * 0.6) * dt;
        }

        c.vx *= Math.exp(-dt * 2.4);
        c.vy *= Math.exp(-dt * 2.4);

        c.x += c.vx * dt;
        c.y += c.vy * dt;

        if (Math.hypot(c.vx, c.vy) > 12) {
          const targetAngle = (Math.atan2(c.vy, c.vx) * 180) / Math.PI;
          c.angle += (targetAngle - c.angle) * Math.min(1, dt * 10);
        }
      }
    }

    // Guides flash & fade decay
    for (let i = this.guides.length - 1; i >= 0; i--) {
      const g = this.guides[i];
      if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2);
      if (!g.dragging) {
        g.op = Math.max(0, g.op - dt * 0.45);
        if (g.op <= 0) {
          this.guides.splice(i, 1);
        }
      }
    }

    // Completion chord when all tasks finish
    if (this.tasks.length > 0 && this.tasks.every((t) => t.state === 'done') && this.layersBuilt >= this.totalLayers) {
      swarmSound.finaleChord();
    }

    // Telemetry updates
    const activeTasks = this.cursors
      .filter((c) => c.task)
      .map((c) => ({
        cursorName: c.name,
        cursorColor: c.color,
        description: `${c.task!.kind.toUpperCase()} ${
          c.task!.text ? `[${c.task!.text.slice(0, 18)}]` : `${Math.round(c.task!.w)}×${Math.round(c.task!.h)}`
        }`,
      }));

    swarmStore.updateTelemetry({
      online: config.enabled,
      state: this.tasks.some((t) => t.state === 'active')
        ? 'BUILDING'
        : this.flockToMouse
        ? 'FLOCKING'
        : 'IDLE',
      activeAgents: this.cursors.filter((c) => c.task).length,
      totalAgents: this.cursors.length,
      layersBuilt: this.layersBuilt,
      totalLayers: Math.max(this.totalLayers, this.layersBuilt),
      backlog,
      activeTasks,
    });
  }

  private render() {
    if (!this.cursorsEl || !this.ovSvg || !this.badgesEl) return;

    // Render Cursors
    const seen = new Set<number>();
    for (const c of this.cursors) {
      seen.add(c.id);
      let el = this.cursorEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'swarm-cursor';
        el.innerHTML = `
          <div class="swarm-cursor-svg"></div>
          <div class="swarm-cursor-tag" style="background:${c.color}">${c.name}</div>
        `;
        this.cursorsEl.appendChild(el);
        this.cursorEls.set(c.id, el);
      }

      el.style.transform = `translate(${f1(c.x)}px, ${f1(c.y)}px)`;

      const svgContainer = el.querySelector<HTMLElement>('.swarm-cursor-svg');
      if (svgContainer) {
        svgContainer.innerHTML = cursorSVG(c.shape, c.color);
        const [hx, hy] = HOT[c.shape];
        const s = 1 - c.press * 0.12;
        svgContainer.style.transformOrigin = `${hx}px ${hy}px`;
        svgContainer.style.transform = `translate(${-hx}px, ${-hy}px) rotate(${f1(c.angle)}deg) scale(${s})`;
      }
    }

    for (const [id, el] of this.cursorEls) {
      if (!seen.has(id)) {
        el.remove();
        this.cursorEls.delete(id);
      }
    }

    // Render Overlay lines & boxes
    let svgStr = '';
    let badgeStr = '';

    // Guides
    for (const g of this.guides) {
      if (!g.vis || g.op <= 0) continue;
      const sw = 1.2 + g.flash * 2;
      const flt = g.flash > 0 ? ` style="filter:drop-shadow(0 0 ${f1(4 + g.flash * 6)}px ${RED})"` : '';
      if (g.axis === 'x') {
        svgStr += `<line x1="${f1(g.cur)}" x2="${f1(g.cur)}" y1="0" y2="${window.innerHeight}" stroke="${RED}" stroke-width="${sw}" opacity="${f1(g.op)}"${flt}/>`;
      } else {
        svgStr += `<line x1="0" x2="${window.innerWidth}" y1="${f1(g.cur)}" y2="${f1(g.cur)}" stroke="${RED}" stroke-width="${sw}" opacity="${f1(g.op)}"${flt}/>`;
      }
    }

    // Polylines (Pen tool)
    for (const line of this.editLines) {
      const pts = line.pts.slice(0, line.placed);
      const allPts = line.owner ? [...pts, { x: line.owner.x, y: line.owner.y }] : pts;
      const ptsStr = allPts.map((p) => `${f1(p.x)},${f1(p.y)}`).join(' ');
      svgStr += `<polyline points="${ptsStr}" fill="none" stroke="${BLUE}" stroke-width="1.8"/>`;
      for (const p of pts) {
        svgStr += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="3.6" fill="#fff" stroke="${BLUE}" stroke-width="1.5"/>`;
      }
    }

    // Cursor Box & Measurement Overlays
    for (const c of this.cursors) {
      if (!c.ov) continue;
      const items: OverlayDraw[] = c.ov();
      for (const v of items) {
        if (v.t === 'box') {
          const col = v.color === 'red' ? RED : v.color === 'cyan' ? CYAN : BLUE;
          const { x, y, w, h } = v.b;
          svgStr += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${col}" stroke-width="1.4" stroke-dasharray="3 3"/>`;

          // Corner handles
          if (v.handles) {
            for (const [hx, hy] of [
              [x, y],
              [x + w, y],
              [x, y + h],
              [x + w, y + h],
            ]) {
              svgStr += `<rect x="${f1(hx - 3)}" y="${f1(hy - 3)}" width="6" height="6" fill="#fff" stroke="${col}" stroke-width="1.2"/>`;
            }
          }

          if (v.badge && w > 0) {
            badgeStr += `<div class="swarm-badge" style="left:${f1(x + w / 2)}px;top:${f1(y + h + 8)}px;border-color:${col}">${v.badge}</div>`;
          }
        } else if (v.t === 'measure') {
          const { a, b, label } = v;
          svgStr += `<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" stroke="${RED}" stroke-width="1.4"/>`;
          badgeStr += `<div class="swarm-badge" style="left:${f1((a.x + b.x) / 2)}px;top:${f1(a.y - 14)}px;border-color:${RED};color:${RED}">${label}</div>`;
        }
      }
    }

    this.ovSvg.innerHTML = svgStr;
    this.badgesEl.innerHTML = badgeStr;
  }
}

export const swarmEngine = new SwarmEngine();
