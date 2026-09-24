/**
 * Sound. Taps, presses and chimes are synthesised, so there is nothing to
 * download and every sound can be placed in space: the mirrored hand's taps
 * come from where that hand is. Voice guidance plays recorded lines, and
 * every line is also shown as text on the card.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private voiceSource: AudioBufferSourceNode | null = null;
  enabled = true;
  voiceEnabled = true;
  base = './';

  /** Must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    }
  }

  private out(pos?: ArrayLike<number>): AudioNode | null {
    if (!this.ctx || !this.master || !this.enabled) return null;
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.3;
    p.rolloffFactor = 0.6;
    p.positionX.value = pos[0];
    p.positionY.value = pos[1];
    p.positionZ.value = pos[2];
    p.connect(this.master);
    return p;
  }

  /** A fingertip tapping wood: a short knock with a soft body. */
  tap(pos?: ArrayLike<number>, gain = 0.7): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    noise.connect(bp).connect(g).connect(dest);
    noise.start(t);
    noise.stop(t + 0.06);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Stone press: a rounded click. */
  press(pos?: ArrayLike<number>): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.14);
    this.tap(pos, 0.35);
  }

  /** A soft two-note chime for a completed step. */
  chime(pos?: ArrayLike<number>, up = true): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = up ? [523.25, 783.99] : [659.25, 523.25];
    notes.forEach((f, i) => {
      for (const [mult, amp] of [
        [1, 0.22],
        [2, 0.06],
        [3.01, 0.03],
      ]) {
        const o = this.ctx!.createOscillator();
        o.frequency.value = f * mult;
        const g = this.ctx!.createGain();
        const st = t + i * 0.13;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(amp, st + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 1.1);
        o.connect(g).connect(dest);
        o.start(st);
        o.stop(st + 1.2);
      }
    });
  }

  /** A pitched note for the table piano, finger 0..4. */
  note(finger: number, pos?: ArrayLike<number>): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const scale = [392, 440, 493.88, 587.33, 659.25];
    const t = this.ctx.currentTime;
    const f = scale[Math.max(0, Math.min(4, finger))];
    for (const [mult, amp, dec] of [
      [1, 0.25, 0.9],
      [2, 0.08, 0.5],
      [4.02, 0.02, 0.2],
    ]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dec + 0.05);
    }
  }

  /** A slow pulse for the tapping metronome. */
  tick(pos?: ArrayLike<number>): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.value = 880;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.06);
  }

  private noise: AudioBuffer | null = null;
  private noiseBuffer(): AudioBuffer {
    if (!this.noise && this.ctx) {
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 1;
      for (let i = 0; i < d.length; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
      this.noise = b;
    }
    return this.noise!;
  }

  /** Plays a recorded voice line; resolves when it ends or after `fallback` seconds. */
  async say(id: string): Promise<void> {
    if (!this.voiceEnabled || !this.ctx || !this.master) return;
    let buf = this.buffers.get(id);
    if (!buf) {
      try {
        const res = await fetch(`${this.base}voice/${id}.mp3`);
        if (!res.ok) return;
        buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(id, buf);
      } catch {
        return;
      }
    }
    this.voiceSource?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    src.connect(g).connect(this.master);
    this.voiceSource = src;
    src.start();
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
    });
  }

  /** Warms the voice cache for upcoming lines. */
  preload(ids: string[]): void {
    if (!this.ctx) return;
    for (const id of ids) {
      if (this.buffers.has(id)) continue;
      fetch(`${this.base}voice/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((a) => this.ctx!.decodeAudioData(a))
        .then((b) => this.buffers.set(id, b))
        .catch(() => undefined);
    }
  }
}

export const sound = new Sound();
