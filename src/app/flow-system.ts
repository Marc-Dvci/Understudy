/**
 * Advances the flow and, in the emulator, the autopilot that acts it out.
 */
import { createSystem, VisibilityState } from '@iwsdk/core';
import { J } from '../core/joints.js';
import { v3 } from '../core/math.js';
import { Autopilot } from './emulation/autopilot.js';
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

  update(delta: number): void {
    const vs = this.world.visibilityState.peek();
    state.immersive = vs !== VisibilityState.NonImmersive;
    if (!state.immersive) return;
    if (this.wantAutopilot && !this.autopilot && !this.tried) {
      this.tried = true;
      const driver = IwerHandDriver.tryCreate();
      if (driver && driver.install()) {
        this.autopilot = new Autopilot(driver, this.demoTable);
        state.emulated = true;
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
