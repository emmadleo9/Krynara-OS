// Procedural Web Audio API sound engine
// Synthesizes typing clacks, mouse clicks, guide snaps, and spatial pentatonic glass piano notes.
// Completely offline, zero audio files required.

const PENTA = [0, 2, 4, 7, 9]; // E F# G# B C#
const E2 = 40;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class SwarmSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private master: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private bpm = 104;
  private slots = new Map<string, number[]>();
  private lastKey = new Map<number, number>();
  private keyTimes: number[] = [];
  private pressTimes: number[] = [];
  private ends: number[] = [];
  public on = true;
  public volume = 0.8;

  constructor() {
    const saved = localStorage.getItem('krynara_swarm_sound');
    if (saved !== null) {
      this.on = saved === 'true';
    }
    const vol = localStorage.getItem('krynara_swarm_volume');
    if (vol !== null) {
      this.volume = Math.max(0, Math.min(1, parseFloat(vol)));
    }
  }

  public init(): boolean {
    if (this.ctx) return true;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
    } catch {
      return false;
    }

    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = this.on ? this.volume : 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.3;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(out);
    out.connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.6, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    verb.connect(wet);
    wet.connect(master);

    this.out = out;
    this.master = master;
    this.verb = verb;
    this.noiseBuf = this.generateNoise(1.5);
    return true;
  }

  public setOn(on: boolean) {
    this.on = on;
    localStorage.setItem('krynara_swarm_sound', String(on));
    if (!this.ctx || !this.out) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(on ? this.volume : 0, t, 0.05);
    if (on && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setVolume(vol: number) {
    this.volume = clamp(vol, 0, 1);
    localStorage.setItem('krynara_swarm_volume', String(this.volume));
    if (!this.ctx || !this.out || !this.on) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.volume, t, 0.05);
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private ready(): boolean {
    if (!this.ctx) this.init();
    return !!(this.ctx && this.on && this.ctx.state === 'running');
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private impulse(secs: number, decay: number): AudioBuffer {
    if (!this.ctx) throw new Error('No audio context');
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * secs);
    const b = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const a = 0.55 - 0.4 * k;
        lp += a * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - k, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return b;
  }

  private generateNoise(secs: number): AudioBuffer {
    if (!this.ctx) throw new Error('No audio context');
    const sr = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(1, Math.floor(sr * secs), sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private pan(x: number, vw: number): number {
    return clamp((x / Math.max(1, vw)) * 1.6 - 0.8, -0.8, 0.8);
  }

  private bus(when: number, panVal: number, send = 0): GainNode {
    if (!this.ctx || !this.master) throw new Error('No audio nodes');
    const g = this.ctx.createGain();
    try {
      if (typeof this.ctx.createStereoPanner === 'function') {
        const p = this.ctx.createStereoPanner();
        p.pan.setValueAtTime(panVal, when);
        g.connect(p);
        p.connect(this.master);
        if (send && this.verb) {
          const s = this.ctx.createGain();
          s.gain.value = send;
          p.connect(s);
          s.connect(this.verb);
        }
      } else {
        g.connect(this.master);
      }
    } catch {
      g.connect(this.master);
    }
    return g;
  }

  public tick(when: number, panVal: number, freq: number, q: number, vel: number, len: number) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.bus(when, panVal, 0.06);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0004, when + len);
    src.connect(bp);
    bp.connect(g);
    src.start(when, Math.random() * 1.2);
    src.stop(when + len + 0.02);
    src.onended = () => g.disconnect();
  }

  // Mechanical typing key: sharp click + resonant thock
  public clack(when: number, panVal: number, space = false, vel = 1) {
    this.tick(when, panVal, rand(3600, 5600), 2.2, rand(0.2, 0.3) * vel, rand(0.006, 0.011));
    this.tick(
      when + rand(0.001, 0.005),
      panVal,
      space ? rand(380, 560) : rand(850, 1500),
      1.6,
      (space ? 0.26 : rand(0.13, 0.2)) * vel,
      space ? 0.065 : rand(0.025, 0.042),
    );
  }

  public key(x: number, vw: number, id: number, n = 1, space = 0) {
    if (!this.ready()) return;
    const t = this.now();
    if (t - (this.lastKey.get(id) || -1) < 0.024) return;
    this.keyTimes = this.keyTimes.filter((k) => t - k < 1);
    if (this.keyTimes.length > 80) return;
    this.lastKey.set(id, t);
    const panVal = this.pan(x, vw);
    let at = t + 0.004;
    for (let k = 0; k < Math.min(n, 3) && this.keyTimes.length <= 80; k++) {
      this.keyTimes.push(t);
      this.clack(at, panVal, space === 1 && k === 0, rand(0.75, 1));
      at += rand(0.018, 0.032);
    }
  }

  // Mouse button press & release click
  public press(x: number, vw: number) {
    if (!this.ready()) return;
    const t = this.now();
    this.pressTimes = this.pressTimes.filter((k) => t - k < 1);
    if (this.pressTimes.length > 40) return;
    this.pressTimes.push(t);
    const panVal = this.pan(x, vw);
    this.tick(t + 0.004, panVal, rand(2100, 2700), 4, 0.32, 0.012);
    this.tick(t + 0.005, panVal, rand(650, 850), 2, 0.16, 0.022);
    this.tick(t + rand(0.055, 0.075), panVal, rand(2900, 3400), 4, 0.15, 0.008);
  }

  public snap(x: number, vw: number) {
    if (!this.ready()) return;
    const t = this.now() + 0.004;
    const panVal = this.pan(x, vw);
    this.tick(t, panVal, 4800, 3, 0.36, 0.012);
    this.tick(t + 0.002, panVal, 1200, 2, 0.2, 0.03);
  }

  public grow(step: number, x: number, vw: number) {
    if (!this.ready()) return;
    const t = this.now() + 0.004;
    this.tick(t, this.pan(x, vw), 2400 + step * 260, 5, 0.12, 0.01);
  }

  // Glass piano in E major pentatonic
  public piano(midi: number, when: number, vel: number, panVal: number, ring = 2.4) {
    if (!this.ctx) return;
    const now = this.now();
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= 28) return;
    const ctx = this.ctx;
    const f = mtof(midi);
    const v = this.bus(when, panVal, 0.85);
    v.gain.value = 0.3 * vel;
    const hi = f > 900;
    const parts = [
      [1, 1, 1],
      [2, 0.38, 0.55],
      [3, 0.12, 0.32],
      [2.756, 0.16, 0.42],
      [5.4, 0.05, 0.16],
    ];
    let last: OscillatorNode | null = null;
    for (const [r, a, d] of parts) {
      if (f * r > 15000) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r * (1 + (Math.random() - 0.5) * 0.002);
      const g = ctx.createGain();
      const dec = ring * d * (hi ? 0.65 : 1);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(a, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0006, when + dec);
      o.connect(g);
      g.connect(v);
      o.start(when);
      o.stop(when + dec + 0.05);
      last = o;
    }
    this.ends.push(when + ring * (hi ? 0.65 : 1));
    if (last) last.onended = () => v.disconnect();
  }

  // Musical note on component placement
  public place(kind: string, x: number, _y: number, w: number, h: number, vw: number, vh: number) {
    if (!this.ready()) return;
    const area = (w * h) / Math.max(1, vw * vh);
    const oct = area > 0.08 ? 1 : area > 0.015 ? 2 : area > 0.002 ? 3 : 4;
    const deg = Math.floor(clamp(x / Math.max(1, vw), 0, 0.999) * 5);
    const midi = E2 + oct * 12 + PENTA[deg];
    const now = this.now();
    const slot = `${Math.round(now * 10)}`;
    const seen = this.slots.get(slot) || [];
    if (seen.length >= 2) return;
    seen.push(midi);
    this.slots.set(slot, seen);
    if (this.slots.size > 40) this.slots.delete(this.slots.keys().next().value || '');
    const panVal = this.pan(x, vw);
    const vel = 0.35;
    const ring = oct <= 1 ? 3.2 : oct >= 4 ? 1.6 : 2.2;
    this.piano(midi, now + 0.01, vel, panVal, ring);
    if (kind === 'dup') {
      this.piano(E2 + 12 + (deg % 2 ? 7 : 0), now + 0.02, 0.18, panVal * 0.5, 2.5);
    }
  }

  // Fan-out arpeggio
  public startFan() {
    if (!this.ready()) return;
    const now = this.now() + 0.02;
    const step = 60 / this.bpm / 4;
    [E2 + 24, E2 + 28, E2 + 31, E2 + 36, E2 + 40].forEach((m, i) =>
      this.piano(m, now + i * step, 0.2, -0.5 + i * 0.25, 2),
    );
  }

  // Completion chord: E major add9
  public finaleChord() {
    if (!this.ready()) return;
    const now = this.now() + 0.02;
    const chord = [E2, E2 + 7, E2 + 12, E2 + 16, E2 + 19, E2 + 26, E2 + 28, E2 + 31];
    chord.forEach((m, i) =>
      this.piano(m, now + i * 0.035, 0.3 - i * 0.015, -0.6 + (i / chord.length) * 1.2, 4.5),
    );
  }
}

export const swarmSound = new SwarmSound();
