/** The short showcase is available only in the desktop emulator. */
export const SHOWCASE_CHAPTERS = ['handover', 'progress', 'measurement'] as const;
export type ShowcaseChapter = typeof SHOWCASE_CHAPTERS[number];

export function showcaseChapter(query: URLSearchParams, emulated: boolean): ShowcaseChapter | null {
  if (!emulated || !query.has('showcase')) return null;
  const wanted = query.get('showcase');
  return SHOWCASE_CHAPTERS.find((chapter) => chapter === wanted) ?? 'handover';
}
