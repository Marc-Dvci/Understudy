/**
 * Holds the session to the headset's frame budget without reducing visual
 * quality. It asks for 72 Hz, the lowest Quest 3 / 3S rate above the 60 fps
 * floor, which gives each frame 13.9 ms; compiles every shader before the
 * routine starts; measures the app's own frame time on the device; and steps
 * down to a lower supported rate only if frames keep running long. It also
 * builds the Device check: frame timing a tester can read out.
 */
import { createSystem } from '@iwsdk/core';
import { APP_VERSION } from '../core/records.js';
import { flow } from './flow/engine.js';
import type { ShaderWarmUp, WarmUpResult } from './render/warmup.js';
import { state } from './state.js';

const WINDOW = 180;
const CHECK_EVERY = 30;
/** Session frame-time histogram: 0.25 ms bins up to 100 ms. */
const BIN_MS = 0.25;
const BINS = 400;

export class QualitySystem extends createSystem({}) {
  private readonly frames = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private n = 0;
  private sampleElapsed = 0;
  private over = 0;
  private total = 0;
  private slowFor = 0;
  step = 0;
  targetHz = 72;
  private sessionSeen: XRSession | null = null;
  private readonly histogram = new Uint32Array(BINS);
  /** Set when the flow starts; built and stepped in XR frames, so programs match the session's render target. */
  private makeWarmUp: (() => ShaderWarmUp) | null = null;
  private warmUp: ShaderWarmUp | null = null;
  warm: WarmUpResult | null = null;

  update(delta: number): void {
    const session = this.world.session;
    if (session && session !== this.sessionSeen) {
      this.sessionSeen = session;
      this.onSession(session);
    }
    if (session && (this.makeWarmUp || this.warmUp)) {
      // a failed warm-up only means shaders compile on first use, as before
      try {
        if (this.makeWarmUp) {
          const make = this.makeWarmUp;
          this.makeWarmUp = null;
          this.warmUp = make();
        }
        if (this.warmUp?.step()) {
          this.warm = this.warmUp.result;
          this.warmUp = null;
        }
      } catch (e) {
        console.warn('[understudy] shader warm-up stopped', e);
        this.warmUp = null;
      }
    }
    if (!state.immersive || flow.paused || delta <= 0 || delta > 0.5) return;
    this.frames[this.n % WINDOW] = delta;
    this.n++;
    this.total++;
    if (delta > 1 / 60 + 0.001) this.over++;
    this.histogram[Math.min(BINS - 1, Math.floor((delta * 1000) / BIN_MS))]++;
    if (this.n < WINDOW) return;
    this.sampleElapsed += delta;
    if (this.n % CHECK_EVERY !== 0) return;
    const p95 = this.percentile(0.95);
    const budget = 1.12 / this.targetHz;
    if (p95 > budget) this.slowFor += this.sampleElapsed;
    else this.slowFor = 0;
    this.sampleElapsed = 0;
    if (this.slowFor > 2 && this.step < 2) {
      this.slowFor = 0;
      this.n = 0;
      this.stepDown();
    }
  }

  private onSession(session: XRSession): void {
    const s = session as XRSession & { frameRate?: number; supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> };
    const rates = s.supportedFrameRates ? Array.from(s.supportedFrameRates) : [];
    this.n = this.sampleElapsed = this.slowFor = this.total = this.over = 0;
    this.step = 0;
    this.histogram.fill(0);
    this.targetHz = rates.includes(72) ? 72 : s.frameRate ?? rates[0] ?? 72;
    if (rates.includes(this.targetHz)) void s.updateTargetFrameRate?.(this.targetHz).catch(() => undefined);
    // Keep the authored material and resolution throughout the session.
    this.world.renderer.xr.setFoveation(0.5);
  }

  /** Compiles every shader over the next XR frames (see render/warmup.ts). */
  requestWarmUp(make: () => ShaderWarmUp): void {
    this.makeWarmUp = make;
  }

  private stepDown(): void {
    this.step++;
    if (this.step <= 2) {
      const s = this.world.session as (XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> }) | undefined;
      const rates = s?.supportedFrameRates ? Array.from(s.supportedFrameRates).filter((r) => r >= 60 && r < this.targetHz) : [];
      const lower = rates.includes(72) ? 72 : rates.length ? Math.max(...rates) : null;
      if (lower !== null) {
        this.targetHz = lower;
        void s?.updateTargetFrameRate?.(lower).catch(() => undefined);
      }
    }
  }

  private percentile(p: number): number {
    this.sorted.set(this.frames);
    this.sorted.sort();
    return this.sorted[Math.min(WINDOW - 1, Math.floor(p * WINDOW))];
  }

  /** Frame interval at quantile `p` over the whole session, in seconds (bin centre). */
  private quantile(p: number): number {
    const target = p * this.total;
    let seen = 0;
    for (let i = 0; i < BINS; i++) {
      seen += this.histogram[i];
      if (seen > target) return ((i + 0.5) * BIN_MS) / 1000;
    }
    return 0;
  }

  /** Summary for the diagnostics code. */
  summary(): Record<string, string | number> {
    const q = (p: number) => (this.total ? this.quantile(p) : 0);
    const feats = ((this.world.session as XRSession & { enabledFeatures?: string[] } | undefined)?.enabledFeatures ?? []).join(' ');
    const ua = navigator.userAgent;
    // IWER can emulate a Quest user agent. Mark emulation before parsing it.
    const device = state.emulated ? 'EMU' : /Quest 3S/i.test(ua) ? 'Q3S' : /Quest 3/i.test(ua) ? 'Q3' : /Quest Pro/i.test(ua) ? 'QP' : /Quest/i.test(ua) ? 'Q' : 'OTHER';
    const valid = (state.hands.left.boneSamples > 0 ? 1 : 0) + (state.hands.right.boneSamples > 0 ? 1 : 0);
    return {
      app: APP_VERSION,
      device,
      hz: this.targetHz,
      p50: Math.round(q(0.5) * 1000 * 10) / 10,
      p95: Math.round(q(0.95) * 1000 * 10) / 10,
      over60: this.total ? Math.round((this.over / this.total) * 1000) / 10 : 0,
      steps: this.step,
      station: state.station.source,
      anchor: state.station.anchored ? 1 : 0,
      hands: valid,
      feats: feats.replace(/[^a-z- ]/g, '').split(' ').map((f) => f.slice(0, 3)).join('.'),
      step: flow.step,
    };
  }

  /** The code shown to testers: compact, readable aloud, no personal data. */
  code(): string {
    const s = this.summary();
    return `${s.app}|${s.device}|${s.hz}|${s.p50}|${s.p95}|${s.over60}|${s.steps}|${s.station}|${s.anchor}|${s.hands}|${s.feats}`;
  }

  /** Device check lines: this session's frame rate in words, then the code. */
  report(): string[] {
    const s = this.summary();
    if (!this.total) return ['Frame timing starts with the routine.', this.code()];
    const fps = Math.round(1000 / Number(s.p50));
    return [
      // the emulator draws at the computer display's rate, whatever the session requests
      s.device === 'EMU' ? `${fps} fps median in the emulator this session.` : `${fps} fps median at ${s.hz} Hz this session.`,
      `${Math.round((100 - Number(s.over60)) * 10) / 10}% of frames within the 60 fps budget.`,
      // spaced so the board can wrap it
      this.code().replace(/\|/g, ' | '),
    ];
  }
}
