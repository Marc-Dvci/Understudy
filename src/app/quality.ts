/**
 * Measures the app's own frame time on the device it runs on and steps down
 * refresh rate when frames run long, without reducing visual quality.
 * It also builds the diagnostics code: a short
 * string a tester can read out that summarises how the device performed.
 */
import { createSystem } from '@iwsdk/core';
import { APP_VERSION } from '../core/records.js';
import { flow } from './flow/engine.js';
import { state } from './state.js';

const WINDOW = 180;
const CHECK_EVERY = 30;

export class QualitySystem extends createSystem({}) {
  private readonly frames = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private n = 0;
  private sampleElapsed = 0;
  private over = 0;
  private total = 0;
  private slowFor = 0;
  step = 0;
  targetHz = 90;
  private sessionSeen: XRSession | null = null;
  private readonly all = new Float32Array(20000);
  private allCount = 0;

  update(delta: number): void {
    const session = this.world.session;
    if (session && session !== this.sessionSeen) {
      this.sessionSeen = session;
      this.onSession(session);
    }
    if (!state.immersive || flow.paused || delta <= 0 || delta > 0.5) return;
    this.frames[this.n % WINDOW] = delta;
    this.n++;
    this.total++;
    if (delta > 1 / 60 + 0.001) this.over++;
    if (this.allCount < this.all.length) this.all[this.allCount++] = delta;
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
    this.allCount = 0;
    this.targetHz = rates.includes(90) ? 90 : rates.includes(72) ? 72 : s.frameRate ?? rates[0] ?? 72;
    if (rates.includes(this.targetHz)) void s.updateTargetFrameRate?.(this.targetHz).catch(() => undefined);
    // Keep the authored material and resolution throughout the session.
    this.world.renderer.xr.setFoveation(0.5);
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

  /** Summary for the diagnostics code. */
  summary(): Record<string, string | number> {
    const v = Array.from(this.all.subarray(0, this.allCount)).sort((a, b) => a - b);
    const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
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
}
