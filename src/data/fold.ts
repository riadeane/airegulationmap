// Accent- and case-insensitive text matching for search. "cote" finds
// Côte d'Ivoire and "turkiye" finds Türkiye: both sides are lower-cased
// and decomposed (NFD) with the combining marks dropped. Pure, no DOM.

const COMBINING_MARKS = /\p{M}/gu;
const CURLY_APOSTROPHES = /[‘’ʼ]/g;

/** Lower-case, strip diacritics, and straighten curly apostrophes. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(CURLY_APOSTROPHES, "'")
    .toLowerCase();
}

/**
 * A folded string plus the way back to the original: `map[i]` is the
 * original index of folded character `i`, and `map[folded.length]` is the
 * original length. `map` is null when folding kept every position, which
 * is the usual case (a precomposed "é" folds to one "e").
 */
export interface FoldedText {
  folded: string;
  map: number[] | null;
}

export function foldWithMap(text: string): FoldedText {
  let folded = '';
  let map: number[] | null = null;
  let pos = 0;
  for (const ch of text) {
    const f = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : foldText(ch);
    // The first character that changes length shifts every later
    // position, so materialise the identity prefix from here on.
    if (map === null && f.length !== ch.length) {
      map = Array.from({ length: folded.length }, (_, i) => i);
    }
    if (map) for (let k = 0; k < f.length; k++) map.push(pos);
    folded += f;
    pos += ch.length;
  }
  if (map) map.push(text.length);
  return { folded, map };
}

/** Original index of folded position `i` (0 ≤ i ≤ folded.length). */
export function originalIndex(text: FoldedText, i: number): number {
  return text.map ? text.map[i] : i;
}

/**
 * First accent- and case-insensitive occurrence of `query` in `text`, as
 * [start, end) offsets into the ORIGINAL string, or null.
 */
export function findFolded(text: string, query: string): { start: number; end: number } | null {
  const q = foldText(query);
  if (!q) return null;
  const f = foldWithMap(text);
  const pos = f.folded.indexOf(q);
  if (pos === -1) return null;
  return { start: originalIndex(f, pos), end: originalIndex(f, pos + q.length) };
}
