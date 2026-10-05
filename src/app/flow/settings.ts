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
import { defaultProfile, toCsv } from '../../core/records.js';

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
    stage.stone({ id: 'set-diag', label: 'Device check', icon: 'chart' });
    stage.stone({ id: 'set-erase', label: 'Erase data', icon: 'stop', accent: '#d9822b' });
    stage.stone({ id: 'set-export', label: 'Export', sub: 'CSV', icon: 'chart' });
    stage.stone({ id: 'set-done', label: 'Back', icon: 'back' });
    stage.board.draw(
      drawMessage('Settings', [
        'Keep side keeps every stone and card on one side of the table.',
        'Dwell: hold a fingertip over a stone to press it without touching.',
        'With both hands out of view, looking at a stone presses it.',
      ]),
    );
    stage.board.show();
    const ids = ['set-side', 'set-keep', 'set-dwell', 'set-voice', 'set-skin', 'set-diag', 'set-export', 'set-erase', 'set-done'];
    stage.layoutStones(ids.slice(0, 4), 'far');
    stage.layoutStones(ids.slice(4, 7), 'mid');
    stage.layoutStones(ids.slice(7), 'near');
    flow.expect = { kind: 'press', id: 'set-done' };
    const id = await stage.press.wait(ids);
    sound.press();
    stage.hideStones();
    if (id === 'set-done') break;
    if (id === 'set-diag') {
      const code = services.quality?.code() ?? 'unavailable';
      stage.board.draw(drawMessage('Device check', ['Read this code to the developer:', code, 'It holds frame timing and the features this headset supports. No personal data.']));
      await flow.wait(8);
      continue;
    }
    if (id === 'set-erase') {
      stage.stone({ id: 'erase-confirm', label: 'Erase', icon: 'stop', accent: '#d9822b' });
      stage.stone({ id: 'erase-cancel', label: 'Keep data', icon: 'back' });
      stage.board.draw(drawMessage('Erase saved data?', ['This removes every saved session and setting.', 'Export a copy first if you want to keep your measurements.']));
      const choice = await flow.choose(['erase-cancel', 'erase-confirm'], 'erase-cancel');
      if (choice === 'erase-cancel') continue;
      try {
        await store.clear();
        await services.station?.eraseAnchor();
        state.profile = defaultProfile();
        sound.voiceEnabled = state.profile.voice;
        stage.skin.color.copy(skinColor(state.profile.skinTone));
        stage.board.draw(drawMessage('Data erased', ['Saved sessions, settings and the stored table anchor have been deleted.']));
      } catch {
        stage.board.draw(drawMessage('Some data could not be cleared', ['Use your browser\'s site-data settings to erase all saved data.']));
      }
      await flow.wait(3);
      continue;
    }
    if (id === 'set-export') {
      const csv = toCsv(await store.sessions());
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'understudy-sessions.csv';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      stage.board.draw(drawMessage('CSV export requested', ['Check your browser\'s Downloads.', 'Sample and unfinished sessions are marked in the file.']));
      await flow.wait(4);
      continue;
    }
    if (id === 'set-side') {
      p.understudy = p.understudy === 'left' ? 'right' : p.understudy === 'right' ? null : 'left';
      if (p.understudy === null) p.program = 'warmup';
      if (p.understudy) await stage.setUnderstudySide(services.base);
    } else if (id === 'set-keep') {
      p.keepSide = p.keepSide === 'none' ? 'right' : p.keepSide === 'right' ? 'left' : 'none';
    } else if (id === 'set-dwell') {
      p.dwellSeconds = p.dwellSeconds >= 2 ? 0.8 : Math.round((p.dwellSeconds + 0.4) * 10) / 10;
    } else if (id === 'set-voice') {
      p.voice = !p.voice;
      sound.voiceEnabled = p.voice;
      if (!p.voice) sound.stopVoice();
    } else if (id === 'set-skin') {
      p.skinTone = (Math.round(p.skinTone) + 1) % SKIN_TONES.length;
      stage.skin.color.copy(skinColor(p.skinTone));
    }
    await store.saveProfile(p);
  }
  stage.board.hide();
}
