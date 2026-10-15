import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { state } from '../state.js';
import type { CardContent } from '../ui/card.js';
import { flow } from './engine.js';

const IDS = ['session-pause', 'session-stop'];
const PAUSED_IDS = new Set(IDS);
const INACTIVE = new Set(['boot', 'find-table', 'home', 'settings', 'stopping', 'visit', 'visit-code', 'visit-wait']);

/** Session controls use the same poke, dwell and gaze input as every other stone. */
export class SessionControls {
  private card: CardContent | null = null;
  private boardWasVisible = false;
  private active = false;

  init(): () => void {
    stage.stone({ id: IDS[0], label: 'Pause', icon: 'pause' });
    stage.stone({ id: IDS[1], label: 'Stop', icon: 'stop', accent: PALETTE.caution });
    return stage.press.onPress((id) => {
      if (!this.active) return;
      if (id === IDS[0]) {
        flow.userPaused = !flow.userPaused;
        stage.press.reset();
        if (flow.userPaused) {
          this.card = stage.card.text;
          this.boardWasVisible = stage.board.target > 0;
          stage.board.hide();
          stage.card.show({ icon: 'pause', title: 'Paused', body: 'Resume when ready. Stop returns home.' });
        } else {
          if (this.card) stage.card.show(this.card);
          if (this.boardWasVisible) stage.board.show();
        }
        stage.press.get(IDS[0])?.setLabel(flow.userPaused ? 'Resume' : 'Pause', undefined, flow.userPaused ? 'next' : 'pause');
        sound.setPaused(flow.paused);
      } else if (id === IDS[1]) {
        sound.stopVoice();
        flow.step = 'stopping';
        flow.interrupt();
        stage.press.allowedIds = null;
        sound.setPaused(flow.paused);
        stage.press.get(IDS[0])?.setLabel('Pause', undefined, 'pause');
      }
    });
  }

  update(): void {
    this.active = state.station.ready && !INACTIVE.has(flow.step);
    stage.press.allowedIds = flow.userPaused ? PAUSED_IDS : null;
    if (this.active) stage.layoutStones(IDS, 'near');
    else for (const id of IDS) stage.press.get(id)?.hide();
  }
}
