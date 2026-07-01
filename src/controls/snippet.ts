// Snippet with the matched term wrapped in <mark>, built from index
// offsets via textContent — no innerHTML with data-derived strings.
// Shared by the search dropdown and the committed-search results list.

import type { SearchMatch } from '../data/searchIndex';

export function snippetNode(match: SearchMatch): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'match-snippet';
  span.appendChild(document.createTextNode(match.snippet.slice(0, match.matchStart)));
  const mark = document.createElement('mark');
  mark.textContent = match.snippet.slice(match.matchStart, match.matchStart + match.matchLength);
  span.appendChild(mark);
  span.appendChild(document.createTextNode(match.snippet.slice(match.matchStart + match.matchLength)));
  return span;
}
