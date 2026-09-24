/**
 * Settings, all reachable with one hand: side, neglect support, dwell time,
 * voice, head gaze, skin tone, erase data.
 */
import { sound } from '../audio.js';
import { SKIN_TONES, skinColor } from '../render/materials.js';
import { stage } from '../stage.js';
import { state } from '../state.js';
import { store } from '../store.js';
import { drawMessage } from '../ui/viz.js';
import { flow } from './engine.js';
import { services } from './services.js';

export async function runSettings(): Promise<void> {
  flow.step = 'settings';
  flow.say('settings-intro', { icon: 'settings', title: 'Settings', body: 'Everything here works with one hand.' });
  for (;;) {
    const p = state.profile;
    stage.stone({ id: 'set-side', label: 'Side', sub: p.understudy ?? 'both', icon: 'both' });
    stage.stone({ id: 'set-keep', label: 'Keep side', sub: p.keepSide, icon: 'eye' });
    stage.stone({ id: 'set-dwell', label: 'Dwell', sub: `${p.dwellSeconds.toFixed(1)} s`, icon: 'touch' });
    stage.stone({ id: 'set-voice', label: 'Voice', sub: p.voice ? 'on' : 'off', icon: 'dot' });
    stage.stone({ id: 'set-skin', label: 'Skin', sub: `${Math.round(p.skinTone) + 1}/${SKIN_TONES.length}`, icon: 'hand' });
    stage.stone({ id: 'set-done', label: 'Back', icon: 'back' });
    stage.board.draw(
      drawMessage('Settings', [
        'Keep side keeps every stone and card on one side of the table.',
        'Dwell: hold a fingertip over a stone to press it without touching.',
        'Looking at a stone for the dwell time presses it too.',
      ]),
    );
    stage.board.show();
    const id = await flow.choose(['set-side', 'set-keep', 'set-dwell', 'set-voice', 'set-skin', 'set-done'], 'set-done');
    if (id === 'set-done') break;
    if (id === 'set-side') {
      p.understudy = p.understudy === 'left' ? 'right' : p.understudy === 'right' ? null : 'left';
      if (p.understudy) await stage.setUnderstudySide(services.base);
    } else if (id === 'set-keep') {
      p.keepSide = p.keepSide === 'none' ? 'right' : p.keepSide === 'right' ? 'left' : 'none';
    } else if (id === 'set-dwell') {
      p.dwellSeconds = p.dwellSeconds >= 2 ? 0.8 : Math.round((p.dwellSeconds + 0.4) * 10) / 10;
    } else if (id === 'set-voice') {
      p.voice = !p.voice;
      sound.voiceEnabled = p.voice;
    } else if (id === 'set-skin') {
      p.skinTone = (Math.round(p.skinTone) + 1) % SKIN_TONES.length;
      stage.skin.color.copy(skinColor(p.skinTone));
    }
    await store.saveProfile(p);
  }
  stage.board.hide();
}
