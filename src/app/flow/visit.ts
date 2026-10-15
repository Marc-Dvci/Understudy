/**
 * Visit: two people, each at their own table, see each other's hands across
 * the mat, as if sitting opposite, and open the flower together. A relative,
 * friend or therapist can keep someone company in a session from anywhere.
 * One person invites and reads out a four-digit code; the other joins with
 * it. Only hand joints travel between the headsets, and nothing is stored.
 */
import { Matrix4 } from '@iwsdk/core';
import { Handedness } from '../../core/joints.js';
import { decodePose, encodePose } from '../../core/pose-codec.js';
import { sound } from '../audio.js';
import { makeGhostMaterial, PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { state } from '../state.js';
import { drawMessage } from '../ui/viz.js';
import { hostVisit, joinVisit, randomCode, type VisitLink } from '../visit-link.js';
import { flow } from './engine.js';
import { celebrate } from './playful.js';

/** How far across the table the other person's hands appear, metres beyond the mat centre. */
const ACROSS = 0.3;
const VISITOR = makeGhostMaterial('#b9a2ef', 0.5);

function query(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export async function runVisit(): Promise<void> {
  flow.step = 'visit';
  const q = query();
  // automated checks run two tabs over a BroadcastChannel instead of the internet
  const transport = q.get('visit') === 'local' ? 'local' : 'peer';
  stage.stone({ id: 'visit-host', label: 'Invite', sub: 'show a code', icon: 'next', accent: '#8b6fd6' });
  stage.stone({ id: 'visit-join', label: 'Join', sub: 'enter a code', icon: 'touch', accent: '#8b6fd6' });
  stage.stone({ id: 'visit-back', label: 'Back', icon: 'back' });
  stage.board.draw(drawMessage('Visit', [
    'Sit at your own tables and see each other\'s hands across the mat.',
    'One person chooses Invite and reads out the code. The other chooses Join.',
    'Only hand movements are sent, live. Nothing is recorded.',
  ], '#8b6fd6'));
  stage.board.show();
  flow.say('visit-intro', { icon: 'hand', title: 'Visit', body: 'Invite someone, or join with their code.' });
  const role = q.get('visitrole') === 'join' ? 'visit-join' : 'visit-host';
  const choice = await flow.choose(['visit-host', 'visit-join', 'visit-back'], role);
  if (choice === 'visit-back') {
    stage.board.hide();
    return;
  }
  const forced = q.get('visitcode');
  const code = choice === 'visit-host' ? (forced && /^\d{4}$/.test(forced) ? forced : randomCode()) : await enterCode(forced);
  if (!code) {
    stage.board.hide();
    return;
  }
  const link = choice === 'visit-host' ? hostVisit(code, transport) : joinVisit(code, transport);
  const closeLink = flow.addCleanup(() => link.close());
  try {
    if (!(await waitOpen(link, choice === 'visit-host'))) return;
    await together(link);
  } finally {
    closeLink();
    stage.board.hide();
  }
}

/** A keypad of stones; returns four digits, or null on Back. */
async function enterCode(expected: string | null): Promise<string | null> {
  flow.step = 'visit-code';
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  for (const d of digits) stage.stone({ id: `visit-d${d}`, label: d, radius: 0.04 });
  stage.stone({ id: 'visit-del', label: 'Delete', icon: 'back', radius: 0.04 });
  stage.stone({ id: 'visit-cancel', label: 'Back', icon: 'stop', accent: PALETTE.caution, radius: 0.04 });
  // two rows of six, clear of the resting fingertips in the middle of the mat
  const far = ['visit-d1', 'visit-d2', 'visit-d3', 'visit-d4', 'visit-d5', 'visit-del'];
  const near = ['visit-d6', 'visit-d7', 'visit-d8', 'visit-d9', 'visit-d0', 'visit-cancel'];
  const ids = [...far, ...near];
  let code = '';
  for (;;) {
    stage.board.draw(drawMessage('Enter the code', [code.padEnd(4, '·').split('').join('  '), 'The person who invited you can read it from their table.'], '#8b6fd6'));
    stage.board.show();
    stage.layoutStones(far, 'far');
    stage.layoutStones(near, 'near');
    const next = expected && /^\d{4}$/.test(expected) ? `visit-d${expected[code.length]}` : 'visit-cancel';
    flow.expect = { kind: 'press', id: next };
    const id = await stage.press.wait(ids);
    sound.press();
    flow.expect = { kind: 'idle' };
    if (id === 'visit-cancel') {
      stage.hideStones();
      return null;
    }
    code = id === 'visit-del' ? code.slice(0, -1) : code + id.slice(-1);
    if (code.length === 4) {
      stage.hideStones();
      return code;
    }
  }
}

/** Waits for the other person; false when the link fails or the user goes back. */
async function waitOpen(link: VisitLink, host: boolean): Promise<boolean> {
  flow.step = 'visit-wait';
  stage.stone({ id: 'visit-cancel', label: 'Back', icon: 'stop', accent: PALETTE.caution });
  stage.layoutStones(['visit-cancel'], 'near');
  stage.board.draw(drawMessage(host ? `Your code: ${link.code.split('').join(' ')}` : 'Joining…', [
    host ? 'Read this code to the person joining you.' : `Code ${link.code}.`,
    'Waiting for the other table.',
  ], '#8b6fd6'));
  stage.board.show();
  let cancelled = false;
  const off = stage.press.onPress((id) => { if (id === 'visit-cancel') cancelled = true; });
  try {
    await flow.until(() => cancelled || link.state === 'open' || link.state === 'error' || link.state === 'closed');
  } finally {
    off();
    stage.hideStones();
  }
  if (link.state === 'open') return true;
  if (!cancelled) {
    stage.board.draw(drawMessage('Visit not connected', [link.error ?? 'The other table left.', 'Return home and try again.'], PALETTE.caution));
    stage.board.show();
    await flow.wait(4);
  }
  return false;
}

/** The shared table: each person's hands across from the other, and the flower together. */
async function together(link: VisitLink): Promise<void> {
  flow.step = 'visit-together';
  stage.board.hide();
  const remote = { left: stage.hands.demoLeft, right: stage.hands.demoRight };
  const poses: Record<Handedness, Float32Array | null> = { left: null, right: null };
  const seen = { left: -Infinity, right: -Infinity };
  let theirReps = 0;
  let cheers = 0;
  const off = link.onMessage((m) => {
    if (m.t === 'hands') {
      for (const h of ['left', 'right'] as Handedness[]) {
        const packed = m[h];
        if (!packed) continue;
        poses[h] = decodePose(packed, poses[h] ?? undefined);
        seen[h] = flow.time;
      }
    } else if (m.t === 'event') {
      if (m.name === 'flower-rep') { theirReps++; sound.chime(undefined, true); }
      else if (m.name === 'cheer') { cheers++; sound.chime(); }
    }
  });
  const hide = flow.addCleanup(() => {
    off();
    for (const h of ['left', 'right'] as Handedness[]) remote[h].setVisible(false);
  });
  stage.stone({ id: 'visit-cheer', label: 'Wave hello', icon: 'hand', accent: '#8b6fd6' });
  stage.stone({ id: 'visit-leave', label: 'Leave', icon: 'back' });
  let leaving = false;
  const offPress = stage.press.onPress((id) => {
    if (id === 'visit-cheer') link.send({ t: 'event', name: 'cheer' });
    if (id === 'visit-leave') leaving = true;
  });
  flow.say('visit-together', { icon: 'open', title: 'Together', body: 'Open and close your hands, slowly, together.' });
  flow.expect = { kind: 'mirror-play', style: 'open-close', bothHands: true };

  const station = new Matrix4();
  const toStation = new Matrix4();
  const across = new Matrix4();
  const joint = new Matrix4();
  const local = new Float32Array(400);
  const shown = new Float32Array(400);
  const packed = { left: new Int16Array(175), right: new Int16Array(175) };
  let seq = 0;
  let frame = 0;
  let mine = 0;
  let wasOpen = false;
  let shownCheers = 0;
  const started = flow.time;
  try {
    await flow.until(() => {
      stage.layoutStones(['visit-cheer', 'visit-leave'], 'far');
      station.copy(stage.table.matrixWorld);
      toStation.copy(station).invert();
      // the other table's frame, turned to face this one from across the mat
      across.makeRotationY(Math.PI).setPosition(0, 0, -ACROSS).premultiply(station);
      // send this table's hands, station-local, at about 36 Hz
      if (++frame % 2 === 0) {
        const msg = { t: 'hands' as const, seq: seq++, left: null as Int16Array | null, right: null as Int16Array | null };
        for (const h of ['left', 'right'] as Handedness[]) {
          if (!state.hands[h].valid) continue;
          for (let j = 0; j < 25; j++) joint.fromArray(state.hands[h].pose, j * 16).premultiply(toStation).toArray(local, j * 16);
          msg[h] = encodePose(local, packed[h]);
        }
        link.send(msg);
      }
      for (const h of ['left', 'right'] as Handedness[]) {
        const p = poses[h];
        const fresh = p && flow.time - seen[h] < 0.5;
        remote[h].setVisible(!!fresh);
        if (!fresh) continue;
        for (let j = 0; j < 25; j++) joint.fromArray(p!, j * 16).premultiply(across).toArray(shown, j * 16);
        remote[h].setMaterial(VISITOR);
        remote[h].apply(shown);
      }
      // each of this person's openings tells the other table
      const opening = Math.max(state.hands.left.valid ? state.hands.left.kin.opening : 0, state.hands.right.valid ? state.hands.right.kin.opening : 0);
      const range = state.openingRange.right;
      const level = (opening - range.closed) / Math.max(0.05, range.open - range.closed);
      if (level > 0.8 && !wasOpen) {
        wasOpen = true;
        mine++;
        link.send({ t: 'event', name: 'flower-rep' });
        celebrate(stage.table.worldToLocal(stage.toWorld(0, -0.05, 0.02)));
      } else if (level < 0.3) wasOpen = false;
      // after the instruction, the card steps aside so the other person's hands are in view
      if (flow.time - started > 5 && stage.card.targetOpacity > 0) stage.card.hide();
      if (cheers > shownCheers) {
        shownCheers = cheers;
        celebrate(stage.table.worldToLocal(stage.toWorld(0, 0.12, 0.02)), 14);
      }
      return leaving || link.state !== 'open';
    });
  } finally {
    offPress();
    hide();
    stage.hideStones();
    flow.expect = { kind: 'idle' };
  }
  stage.board.draw(drawMessage(leaving ? 'Visit finished' : 'The visit ended', [
    ...(leaving ? [] : ['The other table left.']),
    `You opened your hands ${mine} times; they opened theirs ${theirReps} times.`,
  ], '#8b6fd6'));
  stage.board.show();
  await flow.wait(4);
}
