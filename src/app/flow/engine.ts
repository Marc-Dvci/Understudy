/**
 * The flow runner. Scripts are async functions that await time and
 * conditions; both resolve inside the frame update, so a run under virtual
 * time is deterministic. Each step also publishes what it expects the hands
 * to do, which the emulation autopilot reads to act it out.
 */
import { Handedness } from '../../core/joints.js';
import { sound } from '../audio.js';
import { stage } from '../stage.js';
import { CardContent } from '../ui/card.js';
import { LINES } from './lines.js';
import type { SessionRecord } from '../../core/records.js';

export type Expect =
  | { kind: 'idle' }
  | { kind: 'rest' }
  | { kind: 'press'; id: string; hand?: Handedness }
  | { kind: 'move'; movement: 'open' | 'fist' | 'oppose' | 'relax'; hands: Handedness[]; rep?: number }
  | { kind: 'mirror-play'; style: 'open-close' | 'tap' | 'wiggle'; bothHands?: boolean }
  | { kind: 'touch'; target: 'hidden-index'; phase: 'pre' | 'post' }
  | { kind: 'flower' }
  | { kind: 'piano'; finger: number }
  | { kind: 'thumb-touch'; finger: number }
  | { kind: 'tap-rhythm' }
  | { kind: 'warmup-fist'; rep: number }
  | { kind: 'imagine' }
  | { kind: 'residual-touch' };

interface Waiter {
  until: () => boolean;
  resolve: (v: boolean) => void;
  reject: (reason: Error) => void;
  deadline: number;
}

export class FlowInterrupted extends Error {
  constructor() { super('Session stopped'); this.name = 'FlowInterrupted'; }
}

export class FlowEngine {
  time = 0;
  expect: Expect = { kind: 'idle' };
  private waiters: Waiter[] = [];
  suspended = false;
  userPaused = false;
  currentRecord: SessionRecord | null = null;
  get paused(): boolean { return this.suspended || this.userPaused; }
  private readonly pending: Waiter[] = [];
  private readonly cleanups = new Set<() => void>();
  private _step = 'boot';
  /** Step transitions with flow time, for diagnostics and tests. */
  readonly log: { t: number; step: string }[] = [];

  /** Id of the running step, for diagnostics and the autopilot. */
  get step(): string {
    return this._step;
  }

  set step(v: string) {
    if (v === this._step) return;
    this._step = v;
    this.log.push({ t: Math.round(this.time * 10) / 10, step: v });
  }

  update(dt: number): void {
    if (this.paused) return;
    this.time += dt;
    const pending = this.pending;
    pending.push(...this.waiters);
    this.waiters.length = 0;
    for (const w of pending) {
      try {
        if (w.until()) w.resolve(true);
        else if (this.time >= w.deadline) w.resolve(false);
        else this.waiters.push(w);
      } catch (error) { w.reject(error instanceof Error ? error : new Error(String(error))); }
    }
    pending.length = 0;
  }

  /** Waits `seconds` of flow time. */
  wait(seconds: number): Promise<boolean> {
    const end = this.time + seconds;
    return this.until(() => this.time >= end);
  }

  /** Waits for a condition; resolves false on timeout. */
  until(pred: () => boolean, timeout = Infinity): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ until: pred, resolve, reject, deadline: this.time + timeout });
    });
  }

  interrupt(): void {
    const reason = new FlowInterrupted();
    for (const w of this.waiters) w.reject(reason);
    this.waiters.length = 0;
    stage.press.cancelPending(reason);
    this.userPaused = false;
    this.expect = { kind: 'idle' };
    for (const cleanup of this.cleanups) cleanup();
  }

  /** Exercise objects are removed on completion and on Stop. */
  addCleanup(fn: () => void): () => void {
    const cleanup = () => { this.cleanups.delete(cleanup); fn(); };
    this.cleanups.add(cleanup);
    return cleanup;
  }

  /**
   * Shows a card and speaks its line. The card text is the line unless
   * `content` overrides the title; spoken text always matches `LINES[id]`.
   */
  say(id: keyof typeof LINES | null, content: CardContent): void {
    stage.card.show(content);
    if (id) void sound.say(id);
  }

  /** Shows a card, speaks, and waits long enough to read it. */
  async tell(id: keyof typeof LINES | null, content: CardContent, seconds?: number): Promise<void> {
    this.say(id, content);
    const text = id ? LINES[id] : content.title;
    await this.wait(seconds ?? Math.max(1.8, 0.9 + text.split(/\s+/).length * 0.32));
  }

  /** Shows stones and waits for one of them to be pressed. */
  async choose(ids: string[], expectId?: string): Promise<string> {
    stage.layoutStones(ids);
    this.expect = { kind: 'press', id: expectId ?? ids[0] };
    const id = await stage.press.wait(ids);
    sound.press();
    this.expect = { kind: 'idle' };
    await this.wait(0.25);
    stage.hideStones();
    return id;
  }
}

export const flow = new FlowEngine();
