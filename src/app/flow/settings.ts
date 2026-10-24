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
import { careSummaryHtml } from '../../core/report.js';
import { setVoiceCommands, voiceSupported } from './voice-control.js';

/** Hands the browser a file to save, e.g. the CSV or the care summary. */
function download(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function runSettings(): Promise<void> {
  flow.step = 'settings';
  flow.say('settings-intro', { icon: 'settings', title: 'Settings', body: 'Everything here works with one hand.' });
  for (;;) {
    const p = state.profile;
    stage.stone({ radius: 0.04, id: 'set-side', label: 'Side', sub: p.understudy ?? 'both', icon: 'both' });
    stage.stone({ radius: 0.04, id: 'set-keep', label: 'Keep side', sub: p.keepSide, icon: 'eye' });
    stage.stone({ radius: 0.04, id: 'set-dwell', label: 'Dwell', sub: `${p.dwellSeconds.toFixed(1)} s`, icon: 'touch' });
    stage.stone({ radius: 0.04, id: 'set-voice', label: 'Voice', sub: p.voice ? 'on' : 'off', icon: 'dot' });
    stage.stone({ radius: 0.04, id: 'set-skin', label: 'Skin', sub: `${Math.round(p.skinTone) + 1}/${SKIN_TONES.length}`, icon: 'hand' });
    stage.stone({ radius: 0.04, id: 'set-style', label: 'Style', sub: p.style, icon: 'spark' });
    stage.stone({ radius: 0.04, id: 'set-speech', label: 'Spoken', sub: !voiceSupported() ? 'unavailable' : p.voiceCommands ? 'on' : 'off', icon: 'dot' });
    stage.stone({ radius: 0.04, id: 'set-diag', label: 'Device check', icon: 'chart' });
    stage.stone({ radius: 0.04, id: 'set-erase', label: 'Erase data', icon: 'stop', accent: '#d9822b' });
    stage.stone({ radius: 0.04, id: 'set-export', label: 'Export', sub: 'CSV', icon: 'chart' });
    stage.stone({ radius: 0.04, id: 'set-summary', label: 'Summary', sub: 'care team', icon: 'chart' });
    stage.stone({ radius: 0.04, id: 'set-done', label: 'Back', icon: 'back' });
    stage.board.draw(
      drawMessage('Settings', [
        'Keep side keeps every stone and card on one side of the table.',
        'Dwell: hold a fingertip over a stone to press it. Spoken: say a stone\'s name.',
        'With both hands out of view, looking at a stone presses it.',
      ]),
    );
    stage.board.show();
    const ids = ['set-side', 'set-keep', 'set-dwell', 'set-voice', 'set-skin', 'set-style', 'set-speech', 'set-diag', 'set-export', 'set-summary', 'set-erase', 'set-done'];
    // two rows of six: the middle of the mat is where resting fingertips lie
    stage.layoutStones(ids.slice(0, 6), 'far');
    stage.layoutStones(ids.slice(6), 'near');
    flow.expect = { kind: 'press', id: 'set-done' };
    const id = await stage.press.wait(ids);
    sound.press();
    stage.hideStones();
    if (id === 'set-done') break;
    if (id === 'set-diag') {
      const lines = services.quality?.report() ?? ['Frame timing unavailable.'];
      stage.board.draw(drawMessage('Device check', [...lines, 'Frame timing and supported features only. No personal data.']));
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
      download('understudy-sessions.csv', toCsv(await store.sessions()), 'text/csv;charset=utf-8');
      stage.board.draw(drawMessage('CSV export requested', ['Check your browser\'s Downloads.', 'Sample and unfinished sessions are marked in the file.']));
      await flow.wait(4);
      continue;
    }
    if (id === 'set-summary') {
      download('understudy-summary.html', careSummaryHtml(await store.sessions(), p, { generatedAt: Date.now() }), 'text/html;charset=utf-8');
      stage.board.draw(drawMessage('Summary saved', ['A one-page summary for your care team is in Downloads.', 'Open it in any browser and print it, or share the file.']));
      await flow.wait(4);
      continue;
    }
    if (id === 'set-speech') {
      if (!voiceSupported()) {
        stage.board.draw(drawMessage('Spoken commands unavailable', ['This browser has no speech recognition.', 'Every stone still works by touch, hover or gaze.']));
        await flow.wait(4);
        continue;
      }
      p.voiceCommands = setVoiceCommands(!p.voiceCommands);
      stage.board.draw(drawMessage(p.voiceCommands ? 'Spoken commands on' : 'Spoken commands off', p.voiceCommands
        ? ['Say "pause", "resume", "stop", or the name on any stone.', 'Speech is handled by the browser\'s recognition service.']
        : ['Stones work by touch, hover, thumb tap or gaze.']));
      await store.saveProfile(p);
      await flow.wait(3.5);
      continue;
    }
    if (id === 'set-side') {
      p.understudy = p.understudy === 'left' ? 'right' : p.understudy === 'right' ? null : 'left';
      if (p.understudy === null && p.program !== 'deskbreak') p.program = 'warmup';
      if (p.understudy !== null && p.program === 'deskbreak') p.program = 'understudy';
      if (p.understudy) await stage.setUnderstudySide(services.base);
    } else if (id === 'set-keep') {
      p.keepSide = p.keepSide === 'none' ? 'right' : p.keepSide === 'right' ? 'left' : 'none';
    } else if (id === 'set-dwell') {
      p.dwellSeconds = p.dwellSeconds >= 2 ? 0.8 : Math.round((p.dwellSeconds + 0.4) * 10) / 10;
    } else if (id === 'set-voice') {
      p.voice = !p.voice;
      sound.voiceEnabled = p.voice;
      if (!p.voice) sound.stopVoice();
    } else if (id === 'set-style') {
      p.style = p.style === 'calm' ? 'playful' : 'calm';
    } else if (id === 'set-skin') {
      p.skinTone = (Math.round(p.skinTone) + 1) % SKIN_TONES.length;
      stage.skin.color.copy(skinColor(p.skinTone));
    }
    await store.saveProfile(p);
  }
  stage.board.hide();
}
