/**
 * Voice commands, pure. One recognised utterance becomes one intent: pause,
 * resume and stop are spoken commands, and anything else presses a visible
 * stone by its label. Unclear or ambiguous speech returns null and does
 * nothing, so a misheard word never presses the wrong button.
 */

export type VoiceIntent =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stop' }
  | { kind: 'press'; id: string };

export interface StoneLabel { id: string; label: string; sub?: string }

const FILLERS = ['hey understudy', 'understudy', 'please', 'okay', 'ok', 'um', 'uh'];
const PAUSE = ['pause', 'pause please', 'wait', 'hold on'];
const RESUME = ['resume', 'continue', 'go on', 'carry on', 'unpause'];
const STOP = ['stop', 'stop session', 'end session', 'finish'];
/** Spoken alternatives, keyed by what the user says, valued by the label they name. */
const SYNONYMS: Record<string, string> = { yeah: 'yes', yep: 'yes', nope: 'no', 'go back': 'back' };
/** A negated utterance never acts, so "don't stop" cannot press or stop anything. */
const NEGATED = /^(dont|do not|never)( |$)/;

/** Lowercase, apostrophes dropped, every other punctuation mark or dash becomes a space. */
function clean(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Cleans the text and removes leading fillers such as "please", "um" or "hey understudy". */
export function normalise(text: string): string {
  let s = clean(text);
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const filler of FILLERS) {
      if (s === filler) {
        s = '';
        stripped = true;
        break;
      }
      if (s.startsWith(filler + ' ')) {
        s = s.slice(filler.length + 1);
        stripped = true;
        break;
      }
    }
  }
  return s;
}

/** Edit distance between two strings, one insertion, deletion or substitution each. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The cleaned label and any synonyms that name the same stone. */
function spokenForms(stone: StoneLabel): string[] {
  const label = clean(stone.label);
  const aliases = Object.keys(SYNONYMS).filter((alias) => SYNONYMS[alias] === label);
  return [label, ...aliases].filter((form) => form.length > 0);
}

/** True when the form appears in the utterance as whole words. */
function hasWords(utterance: string, form: string): boolean {
  return ` ${utterance} `.includes(` ${form} `);
}

/** Edits allowed for a form: none under 4 characters, 1 under 8, 2 from 8 upwards. */
function fuzzyLimit(form: string): number {
  return form.length >= 8 ? 2 : form.length >= 4 ? 1 : 0;
}

/** Smallest edit distance between the form and the whole utterance or one word window of the same size. */
function fuzzyDistance(utterance: string, form: string): number | null {
  const limit = fuzzyLimit(form);
  if (limit === 0) return null;
  const words = utterance.split(' ');
  const size = form.split(' ').length;
  const candidates = [utterance];
  for (let i = 0; i + size <= words.length; i++) candidates.push(words.slice(i, i + size).join(' '));
  let best: number | null = null;
  for (const candidate of candidates) {
    const distance = levenshtein(candidate, form);
    if (distance <= limit && (best === null || distance < best)) best = distance;
  }
  return best;
}

/**
 * How well one stone matches the utterance, lower is better: 0 exact label,
 * 1 label plus sub, 2 label as whole words, 3 or 4 fuzzy. Null when no match.
 */
function rank(stone: StoneLabel, utterance: string): number | null {
  const forms = spokenForms(stone);
  if (forms.includes(utterance)) return 0;
  if (stone.sub && clean(`${stone.label} ${stone.sub}`) === utterance) return 1;
  if (forms.some((form) => hasWords(utterance, form))) return 2;
  let best: number | null = null;
  for (const form of forms) {
    const distance = fuzzyDistance(utterance, form);
    if (distance !== null && (best === null || distance < best)) best = distance;
  }
  return best === null ? null : 2 + best;
}

/**
 * Maps one recognised utterance to an intent, or null when nothing matches.
 * Pause and resume depend on `paused`; stop works either way. A stone press
 * needs one best match, so two stones tying at the best level return null.
 */
export function matchIntent(transcript: string, stones: StoneLabel[], paused: boolean): VoiceIntent | null {
  const utterance = normalise(transcript);
  if (!utterance || NEGATED.test(utterance)) return null;
  if (!paused && PAUSE.includes(utterance)) return { kind: 'pause' };
  if (paused && RESUME.includes(utterance)) return { kind: 'resume' };
  if (STOP.includes(utterance)) return { kind: 'stop' };

  const ranked = stones
    .map((stone) => ({ id: stone.id, rank: rank(stone, utterance) }))
    .filter((hit): hit is { id: string; rank: number } => hit.rank !== null);
  if (ranked.length === 0) return null;
  const best = Math.min(...ranked.map((hit) => hit.rank));
  const top = ranked.filter((hit) => hit.rank === best);
  return top.length === 1 ? { kind: 'press', id: top[0].id } : null;
}
