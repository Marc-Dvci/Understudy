/**
 * Advances the flow and, in the emulator, the autopilot that acts it out.
 */
import { createSystem, VisibilityState } from '@iwsdk/core';
import { J } from '../core/joints.js';
import { v3 } from '../core/math.js';
import { Autopilot, DEMO_PERSONA } from './emulation/autopilot.js';
import { buildDemoRoom } from './render/demo-room.js';
import { IwerHandDriver } from './emulation/iwer-driver.js';
import { flow } from './flow/engine.js';
import { state } from './state.js';

export class FlowSystem extends createSystem({}) {
  autopilot: Autopilot | null = null;
  private tried = false;
  /** Enable the autopilot when running under the IWER emulator. */
  wantAutopilot = false;
  /** Table centre for the autopilot's seated pose (SEM office_small desk). */
  demoTable = v3(0.06, 0.75, -0.62);
  /** Draw the procedural study; off when an SEM room supplies the scene. */
  demoRoom = true;
  /** Head height above the table for the seated autopilot, metres. */
  seatHeight = 0.42;

  update(delta: number): void {
    const vs = this.world.visibilityState.peek();
    state.immersive = vs !== VisibilityState.NonImmersive;
    if (!state.immersive) return;
    if (this.wantAutopilot && !this.autopilot && !this.tried) {
      this.tried = true;
      const driver = IwerHandDriver.tryCreate();
      if (driver && driver.install()) {
        const q = new URLSearchParams(location.search);
        const input = q.get('input');
        const persona = { ...DEMO_PERSONA, weakSide: input === 'left' ? ('right' as const) : ('left' as const) };
        if (q.has('seat')) this.seatHeight = Number(q.get('seat'));
        // tests seat the user at a given table: ?table=x,y,z&facing=fx,fz
        const table = q.get('table')?.split(',').map(Number);
        if (table && table.length === 3) this.demoTable = v3(table[0], table[1], table[2]);
        const face = q.get('facing')?.split(',').map(Number);
        const facing = face && face.length === 2 ? v3(face[0], 0, face[1]) : v3(0, 0, -1);
        this.autopilot = new Autopilot(driver, this.demoTable, persona, facing);
        this.autopilot.head[1] = this.demoTable[1] + this.seatHeight;
        // films use a narrower camera than the headset's own field of view
        const fov = Number(q.get('fov'));
        if (fov > 20 && fov < 120) (driver.device as unknown as { fovy: number }).fovy = (fov * Math.PI) / 180;
        if (input === 'dwell') this.autopilot.inputMode = 'dwell';
        if (input === 'gaze') this.autopilot.inputMode = 'gaze';
        state.emulated = true;
        if (this.demoRoom) {
          this.world.createTransformEntity(
            buildDemoRoom({ deskTop: [this.demoTable[0], this.demoTable[1], this.demoTable[2]] }),
          );
        }
      }
    }
    if (vs === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    flow.update(dt);
    if (this.autopilot) {
      this.player.updateWorldMatrix(true, false);
      this.autopilot.update(dt, this.player.matrixWorld.elements);
    }
  }
}

export { J };
