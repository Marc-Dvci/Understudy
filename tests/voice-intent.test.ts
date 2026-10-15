import { describe, expect, it } from 'vitest';
import { levenshtein, matchIntent, normalise, StoneLabel } from '../src/core/voice-intent.js';

const STONES: StoneLabel[] = [
  { id: 'today', label: 'Today' },
  { id: 'progress', label: 'Progress' },
  { id: 'settings', label: 'Settings' },
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'back', label: 'Back' },
  { id: 'little', label: 'A little' },
  { id: 'warmup', label: 'Warm-up', sub: 'stiff hands' },
];

describe('normalise', () => {
  it('lowercases, strips punctuation, collapses spaces and trims', () => {
    expect(normalise('  Show   ME, progress!! ')).toBe('show me progress');
  });

  it('treats hyphens as spaces so "Warm-up" and "warm up" agree', () => {
    expect(normalise('Warm-up')).toBe(normalise('warm up'));
  });

  it('drops leading fillers, including the wake phrase', () => {
    expect(normalise('Hey Understudy, um, please pause.')).toBe('pause');
  });

  it('keeps "please" when it is not leading', () => {
    expect(normalise('pause please')).toBe('pause please');
  });
});

describe('pause and resume gating', () => {
  it.each(['pause', 'pause please', 'wait', 'hold on'])('pauses on "%s" while playing', (said) => {
    expect(matchIntent(said, STONES, false)).toEqual({ kind: 'pause' });
  });

  it('does not pause again when already paused', () => {
    expect(matchIntent('pause', STONES, true)).toBeNull();
  });

  it.each(['resume', 'continue', 'go on', 'carry on', 'unpause'])('resumes on "%s" while paused', (said) => {
    expect(matchIntent(said, STONES, true)).toEqual({ kind: 'resume' });
  });

  it('does not resume while playing', () => {
    expect(matchIntent('continue', STONES, false)).toBeNull();
  });

  it('prefers the resume command over a Resume stone while paused', () => {
    const withResume = [...STONES, { id: 'resume-stone', label: 'Resume' }];
    expect(matchIntent('resume', withResume, true)).toEqual({ kind: 'resume' });
  });

  it('presses a Resume stone while playing, since the command is not active', () => {
    const withResume = [...STONES, { id: 'resume-stone', label: 'Resume' }];
    expect(matchIntent('resume', withResume, false)).toEqual({ kind: 'press', id: 'resume-stone' });
  });
});

describe('stop', () => {
  it.each(['stop', 'stop session', 'end session', 'finish'])('stops on "%s" while playing', (said) => {
    expect(matchIntent(said, STONES, false)).toEqual({ kind: 'stop' });
  });

  it('stops on "stop" while paused too', () => {
    expect(matchIntent('stop', STONES, true)).toEqual({ kind: 'stop' });
  });

  it('does not treat "don\'t stop" as stop, paused or not', () => {
    expect(matchIntent("Don't stop.", STONES, false)).toBeNull();
    expect(matchIntent("don't stop", STONES, true)).toBeNull();
  });

  it('accepts a filler in front of a command', () => {
    expect(matchIntent('Okay, um, please stop', STONES, false)).toEqual({ kind: 'stop' });
  });
});

describe('stone matching', () => {
  it('presses a stone on its exact label, ignoring case', () => {
    expect(matchIntent('Progress', STONES, false)).toEqual({ kind: 'press', id: 'progress' });
    expect(matchIntent('settings', STONES, false)).toEqual({ kind: 'press', id: 'settings' });
  });

  it('matches a hyphenated label with its spoken words, and label plus sub', () => {
    expect(matchIntent('warm up', STONES, false)).toEqual({ kind: 'press', id: 'warmup' });
    expect(matchIntent('warm-up', STONES, false)).toEqual({ kind: 'press', id: 'warmup' });
    expect(matchIntent('warm up stiff hands', STONES, false)).toEqual({ kind: 'press', id: 'warmup' });
  });

  it('matches a label contained in the utterance as whole words', () => {
    expect(matchIntent('show me progress', STONES, false)).toEqual({ kind: 'press', id: 'progress' });
  });

  it('fuzzy-matches a misheard label of 8 characters within two edits', () => {
    expect(matchIntent('progres', STONES, false)).toEqual({ kind: 'press', id: 'progress' });
    expect(matchIntent('setings', STONES, false)).toEqual({ kind: 'press', id: 'settings' });
    expect(matchIntent('show me setings', STONES, false)).toEqual({ kind: 'press', id: 'settings' });
  });

  it('does not fuzzy-match a 3-letter label, so "yet" is not "Yes"', () => {
    expect(matchIntent('yet', STONES, false)).toBeNull();
  });

  it('prefers an exact label over a stone that only contains the words', () => {
    const pair = [
      { id: 'contains', label: 'Warm up' },
      { id: 'exact', label: 'Warm up now' },
    ];
    expect(matchIntent('warm up now', pair, false)).toEqual({ kind: 'press', id: 'exact' });
  });

  it('returns null when two stones tie on an exact label', () => {
    const twins = [
      { id: 'a', label: 'Next' },
      { id: 'b', label: 'Next' },
    ];
    expect(matchIntent('next', twins, false)).toBeNull();
  });

  it('returns null when two stones tie on containing the words', () => {
    const overlap = [
      { id: 'p', label: 'Progress' },
      { id: 'pr', label: 'Progress report' },
    ];
    expect(matchIntent('show progress report', overlap, false)).toBeNull();
  });

  it('returns null for an utterance that matches nothing', () => {
    expect(matchIntent('the weather is nice', STONES, false)).toBeNull();
  });
});

describe('synonyms', () => {
  it.each([
    ['yes', 'yes'],
    ['yeah', 'yes'],
    ['yep', 'yes'],
    ['no', 'no'],
    ['nope', 'no'],
    ['back', 'back'],
    ['go back', 'back'],
  ])('"%s" presses the stone for %s', (said, id) => {
    expect(matchIntent(said, STONES, false)).toEqual({ kind: 'press', id });
  });
});

describe('empty input', () => {
  it.each(['', '   ', 'um, uh', ' , '])('returns null for %j', (said) => {
    expect(matchIntent(said, STONES, false)).toBeNull();
  });
});

describe('levenshtein', () => {
  it('counts single-character edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('setings', 'settings')).toBe(1);
    expect(levenshtein('same', 'same')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
