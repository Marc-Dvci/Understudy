/**
 * Spoken commands, for anyone with one usable hand, or a tired one: "pause",
 * "resume", "stop", or the label of any visible stone presses it through the
 * same input path as a touch. Off by default; available where the browser
 * supports speech recognition.
 */
import { matchIntent, StoneLabel } from '../../core/voice-intent.js';
import { stage } from '../stage.js';
import { VoiceCommands } from '../voice-commands.js';
import { flow } from './engine.js';

let commands: VoiceCommands | null = null;
/** The last thing heard and what it did, for Settings and diagnostics. */
export const heard = { text: '', action: '' };

export function voiceSupported(): boolean {
  return VoiceCommands.supported;
}

export function voiceListening(): boolean {
  return !!commands?.listening;
}

/** Turns listening on or off; returns whether it is now listening. */
export function setVoiceCommands(on: boolean): boolean {
  if (!on) {
    commands?.stop();
    return false;
  }
  if (!VoiceCommands.supported) return false;
  commands = commands ?? new VoiceCommands(handle);
  return commands.start();
}

/** Applies one utterance. Exported for tests and for the emulator. */
export function handle(transcript: string): string {
  const stones: StoneLabel[] = stage.press.all()
    .filter((s) => s.shown && s.enabled && (!stage.press.allowedIds || stage.press.allowedIds.has(s.id)))
    .map((s) => ({ id: s.id, ...s.text }));
  const intent = matchIntent(transcript, stones, flow.userPaused);
  heard.text = transcript;
  heard.action = intent ? (intent.kind === 'press' ? `press ${intent.id}` : intent.kind) : 'none';
  if (!intent) return heard.action;
  // pause, resume and stop are the session controls' own stones
  const id = intent.kind === 'press' ? intent.id : intent.kind === 'stop' ? 'session-stop' : 'session-pause';
  const stone = stage.press.get(id);
  if (!stone?.shown) return `${heard.action} (not shown)`;
  stage.press.press(id, 'voice');
  return heard.action;
}
