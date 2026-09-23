import { getState, setState, on } from '../state/store';
import { el } from '../dom';
import { updateMap } from '../map/index';
import { buildScoresAtDate, extractSortedDates, historyBreaks } from '../data/history';
import type { HistoryBreak, HistoryData, HistorySnapshot } from '../data/history';

// Module-scope so the map subscription (added in initTimeline) can
// resolve `timelineDate` → historic scores without re-reading history.
let historyRef: HistoryData | null = null;
let sortedDatesRef: string[] = [];

// Resolve the state's `timelineDate` to the actual scores to render.
// Null / absent / "latest" dates map to the current scoreData.
function scoresForDate(date: string | null): Record<string, HistorySnapshot> | undefined {
  if (!date || !historyRef) return undefined;
  if (!sortedDatesRef.includes(date)) return undefined;
  return buildScoresAtDate(historyRef, date);
}

// One tick under the slider track per calibration break, with the reason
// in its tooltip. A break normally coincides with a snapshot date (the run
// re-scored every country); when it does not, the tick sits at the first
// snapshot date after it.
function renderBreakMarkers(breaks: HistoryBreak[], sortedDates: string[]): void {
  const track = document.getElementById('timeline-track');
  if (!track) return;
  track.querySelectorAll('.timeline-break').forEach(node => node.remove());

  const span = sortedDates.length - 1;
  for (const brk of breaks) {
    let idx = sortedDates.indexOf(brk.date);
    if (idx < 0) idx = sortedDates.findIndex(date => date > brk.date);
    if (idx < 0) continue;

    const marker = document.createElement('span');
    marker.className = 'timeline-break';
    // The thumb travels a track shorter than the input by its own width,
    // so the CSS offsets the tick by the thumb's half-width at either end.
    marker.style.setProperty('--position', String(idx / span));
    const text = `Recalibration on ${brk.date}: ${brk.reason}`;
    marker.title = text;
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', text);
    track.appendChild(marker);
  }
}

export function initTimeline(history: HistoryData | null): void {
  if (!history) return;

  const sortedDates = extractSortedDates(history);
  if (sortedDates.length <= 1) return;

  historyRef = history;
  sortedDatesRef = sortedDates;

  const container = document.getElementById('timeline-strip')!;
  container.style.display = 'block';

  const slider = el<HTMLInputElement>('timeline-slider');
  slider.max = String(sortedDates.length - 1);
  renderBreakMarkers(historyBreaks(history), sortedDates);

  const dateLabel = document.getElementById('timeline-date-label')!;

  // Position the slider based on initial state - URL may have supplied
  // a `date` param before we got here. If the URL's date isn't in the
  // snapshot list, fall back to latest rather than erroring.
  const { timelineDate: initialDate } = getState();
  let initialIdx = sortedDates.length - 1;
  if (initialDate) {
    const i = sortedDates.indexOf(initialDate);
    if (i >= 0) initialIdx = i;
    else setState({ timelineDate: null }); // sanitize unknown date
  }
  slider.value = String(initialIdx);
  dateLabel.textContent = initialIdx === sortedDates.length - 1 ? 'Latest' : sortedDates[initialIdx];

  // If we loaded in on a historic date, kick a re-render now. The map
  // subscription (below) would only fire on *changes*, so the initial
  // paint still shows latest scores without this.
  if (initialDate && sortedDates.includes(initialDate)) {
    updateMap(scoresForDate(initialDate));
  }

  slider.addEventListener('input', function () {
    const idx = parseInt(this.value);
    const isLatest = idx === sortedDates.length - 1;
    const selectedDate = sortedDates[idx];
    dateLabel.textContent = isLatest ? 'Latest' : selectedDate;
    setState({ timelineDate: isLatest ? null : selectedDate });
  });

  document.getElementById('timeline-reset')!.addEventListener('click', () => {
    slider.value = String(sortedDates.length - 1);
    dateLabel.textContent = 'Latest';
    setState({ timelineDate: null });
  });

  // Any change to `timelineDate` (slider, reset, popstate, URL load)
  // re-renders the map. The slider input handler itself doesn't need
  // to call updateMap - this subscription is the single write seam.
  on('timelineDate', (date) => {
    updateMap(scoresForDate(date));

    // Also keep the slider position and label in sync when the change
    // comes from elsewhere (popstate / URL). The input handler would
    // otherwise read its own value as stale on external writes.
    const idx = date ? sortedDates.indexOf(date) : sortedDates.length - 1;
    if (idx >= 0 && parseInt(slider.value) !== idx) {
      slider.value = String(idx);
      dateLabel.textContent = idx === sortedDates.length - 1 ? 'Latest' : sortedDates[idx];
    }
  });
}
