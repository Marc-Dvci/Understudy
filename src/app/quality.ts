/**
 * Measures the app's own frame time on the device it runs on and steps down
 * cost when frames run long, in this order: more foveation, 90 to 72 Hz,
 * the cheaper hand shader. It also builds the diagnostics code: a short
 * string a tester can read out that summarises how the device performed.
 */
import { createSystem } from '@iwsdk/core';
import { APP_VERSION } from '../core/records.js';
import { flow } from './flow/engine.js';
import { stage } from './stage.js';
import { state } from './state.js';

const WINDOW = 180;

export class QualitySystem extends createSystem({}) {
  private readonly frames = new Float32Array(WINDOW);
  private n = 0;
  private over = 0;
  private total = 0;
  private slowFor = 0;
  step = 0;
  targetHz = 90;
  private sessionSeen: XRSession | null = null;
  private all: number[] = [];

  update(delta: number): void {
    const session = this.world.session;
    if (session && session !== this.sessionSeen) {
      this.sessionSeen = session;
      this.onSession(session);
    }
    if (!state.immersive || delta <= 0 || delta > 0.5) return;
    this.frames[this.n % WINDOW] = delta;
    this.n++;
    this.total++;
    if (delta > 1 / 60 + 0.001) this.over++;
    if (this.all.length < 20000) this.all.push(delta);
    if (this.n < WINDOW) return;
    const p95 = this.percentile(0.95);
    const budget = 1.12 / this.targetHz;
    if (p95 > budget) this.slowFor += delta;
    else this.slowFor = 0;
    if (this.slowFor > 2 && this.step < 3) {
      this.slowFor = 0;
      this.n = 0;
      this.stepDown();
    }
  }

  private onSession(session: XRSession): void {
    const s = session as XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> };
    const rates = s.supportedFrameRates ? Array.from(s.supportedFrameRates) : [];
    this.targetHz = rates.includes(90) ? 90 : rates.includes(72) ? 72 : 72;
    if (rates.includes(this.targetHz)) void s.updateTargetFrameRate?.(this.targetHz).catch(() => undefined);
    this.world.renderer.xr.setFoveation(0.5);
  }

  private stepDown(): void {
    this.step++;
    if (this.step === 1) {
      this.world.renderer.xr.setFoveation(1);
    } else if (this.step === 2) {
      const s = this.world.session as (XRSession & { updateTargetFrameRate?: (r: number) => Promise<void> }) | undefined;
      this.targetHz = 72;
      void s?.updateTargetFrameRate?.(72).catch(() => undefined);
    } else if (this.step === 3) {
      // the skin shader without its sheen and clearcoat lobes; tone, ghosts
      // and occluders keep their own materials
      stage.skin.sheen = 0;
      stage.skin.clearcoat = 0;
      stage.skin.needsUpdate = true;
    }
  }

  private percentile(p: number): number {
    const v = Array.from(this.frames).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(p * v.length))];
  }

  /** Summary for the diagnostics code. */
  summary(): Record<string, string | number> {
    const v = [...this.all].sort((a, b) => a - b);
    const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
    const feats = ((this.world.session as XRSession & { enabledFeatures?: string[] } | undefined)?.enabledFeatures ?? []).join(' ');
    const ua = navigator.userAgent;
    const device = /Quest 3S/i.test(ua) ? 'Q3S' : /Quest 3/i.test(ua) ? 'Q3' : /Quest Pro/i.test(ua) ? 'QP' : /Quest/i.test(ua) ? 'Q' : state.emulated ? 'EMU' : 'OTHER';
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
