/** The short showcase is available only in the desktop emulator. */
export const SHOWCASE_CHAPTERS = ['handover', 'progress', 'measurement'] as const;
export type ShowcaseChapter = typeof SHOWCASE_CHAPTERS[number];

/** Referral metadata preserves the ordinary first-click desktop showcase. */
export function isShowcaseLanding(query: URLSearchParams, emulated: boolean): boolean {
  if (!emulated) return false;
  return query.has('showcase') || [...query.keys()].every((key) =>
    key.startsWith('utm_') || key === 'ref' || key === 'fbclid' || key === 'gclid');
}

export function showcaseChapter(query: URLSearchParams, emulated: boolean): ShowcaseChapter | null {
  if (!emulated || !query.has('showcase')) return null;
  const wanted = query.get('showcase');
  return SHOWCASE_CHAPTERS.find((chapter) => chapter === wanted) ?? 'handover';
}
