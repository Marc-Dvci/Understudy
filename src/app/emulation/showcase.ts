import { assistanceForSession } from '../../core/assistance.js';
import { historyFor, SessionRecord } from '../../core/records.js';
import { Stage } from '../../core/rehearse.js';
import { sound } from '../audio.js';
import { flow, FlowInterrupted } from '../flow/engine.js';
import { showProgress } from '../flow/progress.js';
import { services } from '../flow/services.js';
import { handPrint, showHandPrint, startMirror, stopMirror } from '../flow/steps.js';
import { stage } from '../stage.js';
import { state } from '../state.js';
import { drawMeter } from '../ui/viz.js';
import { ShowcaseChapter, SHOWCASE_CHAPTERS } from './showcase-options.js';

const COPY: Record<ShowcaseChapter, [string, string]> = {
  handover: ['One mirror. A share for each finger.', 'Compare Watch, Rehearse and Perform on the same movement. Rehearse uses settings computed from 21 simulated visits.'],
  progress: ['A reason to return tomorrow.', 'An earlier closed-hand pose sits beside the latest one. Above margin means a change exceeds the estimated measurement-error margin.'],
  measurement: ['Measure before changing assistance.', 'The simulated actor makes three movements, three times, through the app’s hand-tracking measurement path. The results here are temporary.'],
};
const MODES: Stage[] = ['watch', 'rehearse', 'perform'];
const MODE_LABELS: Record<Stage, string> = { watch: 'Watch', rehearse: 'Rehearse', perform: 'Perform' };

/** A navigable, non-recording preview. It never runs on a physical headset. */
export async function runShowcase(initial: ShowcaseChapter, records: SessionRecord[]): Promise<void> {
  if (!state.emulated) return;
  const root = document.getElementById('showcase-controls');
  if (!root) return;
  state.profile.understudy = 'left';
  state.profile.program = 'understudy';
  await stage.setUnderstudySide(services.base);
  const history = historyFor(records, 'understudy', 'left');
  const current = history[history.length - 1];
  if (!current) return;
  const daily = assistanceForSession(history, current, 'left');
  let chapter = initial;
  let requested: ShowcaseChapter | null = null;
  let mode: Stage = 'rehearse';
  let finished = false;
  let ready = false;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-chapter]')];
  const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('button[data-mode]')];
  const heading = root.querySelector<HTMLElement>('#showcase-heading')!;
  const copy = root.querySelector<HTMLElement>('#showcase-copy')!;
  const modeNote = root.querySelector<HTMLElement>('#showcase-mode-note')!;
  const pause = root.querySelector<HTMLButtonElement>('#showcase-pause')!;
  const modes = root.querySelector<HTMLElement>('#showcase-modes')!;
  const refreshPause = () => { pause.textContent = flow.userPaused ? 'Resume' : 'Pause'; pause.setAttribute('aria-pressed', String(flow.userPaused)); };
  const offPress = stage.press.onPress(refreshPause);

  const drawMode = () => {
    for (const [f, control] of state.mirror.controls.entries()) {
      control.share = mode === 'watch' ? 0 : mode === 'perform' ? 1 : daily[f].share;
      control.gain = mode === 'rehearse' ? daily[f].gain : 1;
    }
    services.mirror!.forceWatch = mode === 'watch';
    // This chapter isolates the blend comparison. The full-session path
    // retains rest calibration and attempt detection.
    services.mirror!.attemptPhase = 'off';
    const shares = state.mirror.controls.map((control) => control.share);
    stage.meter.draw(drawMeter(shares, `${MODE_LABELS[mode]}: own-movement share`, [0, 0, 0, 0, 0]));
    stage.meter.show();
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    modeNote.textContent = mode === 'watch'
      ? 'Watch: the Lead reflection supplies the displayed movement.'
      : mode === 'perform'
        ? 'Perform: the simulated weaker hand supplies the displayed movement.'
        : `Rehearse: index ${Math.round(shares[1] * 100)}%, middle ${Math.round(shares[2] * 100)}%, ring ${Math.round(shares[3] * 100)}%, little ${Math.round(shares[4] * 100)}% own-movement settings. These describe the blend, not effort.`;
  };

  const select = (next: ShowcaseChapter) => {
    requested = next;
    ready = false;
    sound.stopVoice();
    flow.interrupt();
    stage.press.get('session-pause')?.setLabel('Pause', undefined, 'pause');
    sound.setPaused(flow.paused);
    refreshPause();
  };
  const onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const next = button.dataset.chapter;
    if (SHOWCASE_CHAPTERS.includes(next as ShowcaseChapter)) select(next as ShowcaseChapter);
    else if (MODES.includes(button.dataset.mode as Stage) && ready && chapter === 'handover') {
      mode = button.dataset.mode as Stage;
      drawMode();
    } else if (button.id === 'showcase-pause') stage.press.press('session-pause', 'poke');
    else if (button.id === 'showcase-replay') select(chapter);
    else if (button.id === 'showcase-exit') {
      const next = new URL(location.href);
      next.search = '?fresh&seed=21';
      location.assign(next);
    }
  };
  root.addEventListener('click', onClick);
  root.hidden = false;
  document.body.classList.add('showcase-active');
  flow.currentRecord = null;
  try {
    while (!finished) {
      if (requested) { chapter = requested; requested = null; }
      const query = new URLSearchParams(location.search);
      query.set('showcase', chapter);
      historyReplace(query);
      root.dataset.chapter = chapter;
      root.dataset.ready = 'false';
      heading.textContent = COPY[chapter][0];
      copy.textContent = COPY[chapter][1];
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.chapter === chapter));
      modes.hidden = chapter !== 'handover';
      modeNote.hidden = chapter !== 'handover';
      modeButtons.forEach((button) => { button.disabled = true; });
      stage.board.hide();
      stage.meter.hide();
      stage.card.hide();
      stopMirror();
      try {
        if (chapter === 'handover') {
          flow.step = 'showcase-handover';
          if (!(await startMirror())) throw new Error('Showcase could not calibrate its simulated hands');
          flow.step = 'showcase-handover';
          flow.expect = { kind: 'mirror-play', style: 'open-close', bothHands: true };
          drawMode();
          modeButtons.forEach((button) => { button.disabled = false; });
          stage.card.hide();
          ready = true;
          root.dataset.ready = 'true';
          await flow.until(() => false);
        } else if (chapter === 'progress') {
          ready = true;
          root.dataset.ready = 'true';
          flow.expect = { kind: 'rest' };
          await showProgress({ hold: true });
        } else {
          const print = await handPrint(['left', 'right']);
          await showHandPrint(print, history);
          ready = true;
          root.dataset.ready = 'true';
          await flow.until(() => false);
        }
      } catch (error) {
        if (!(error instanceof FlowInterrupted)) throw error;
        if (!requested) finished = true;
      } finally {
        stage.board.hide();
        stage.meter.hide();
        stopMirror();
        if (services.mirror) { services.mirror.forceWatch = true; services.mirror.attemptPhase = 'off'; }
      }
    }
  } finally {
    offPress();
    root.removeEventListener('click', onClick);
    root.hidden = true;
    document.body.classList.remove('showcase-active');
    flow.userPaused = false;
    stage.press.get('session-pause')?.setLabel('Pause', undefined, 'pause');
    sound.setPaused(flow.paused);
    window.dispatchEvent(new Event('resize'));
  }
}

function historyReplace(query: URLSearchParams): void {
  window.history.replaceState(null, '', `${location.pathname}?${query}${location.hash}`);
}
