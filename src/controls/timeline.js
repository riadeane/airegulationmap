import { getState, setState, on } from '../state/store.js';
import { updateMap } from '../map/index.js';
import { buildScoresAtDate, extractSortedDates } from '../data/history.js';

// Module-scope so the map subscription (added in initTimeline) can
// resolve `timelineDate` → historic scores without re-reading history.
let historyRef = null;
let sortedDatesRef = [];

// Resolve the state's `timelineDate` to the actual scores to render.
// Null / absent / "latest" dates map to the current scoreData.
function scoresForDate(date) {
  if (!date || !historyRef) return undefined;
  if (!sortedDatesRef.includes(date)) return undefined;
  return buildScoresAtDate(historyRef, date);
}

export function initTimeline(history) {
  if (!history) return;

  const sortedDates = extractSortedDates(history);
  if (sortedDates.length <= 1) return;

  historyRef = history;
  sortedDatesRef = sortedDates;

  const container = document.getElementById('timeline-strip');
  container.style.display = 'block';

  const slider = document.getElementById('timeline-slider');
  slider.max = sortedDates.length - 1;

  const dateLabel = document.getElementById('timeline-date-label');

  // Position the slider based on initial state — URL may have supplied
  // a `date` param before we got here. If the URL's date isn't in the
  // snapshot list, fall back to latest rather than erroring.
  const { timelineDate: initialDate } = getState();
  let initialIdx = sortedDates.length - 1;
  if (initialDate) {
    const i = sortedDates.indexOf(initialDate);
    if (i >= 0) initialIdx = i;
    else setState({ timelineDate: null }); // sanitize unknown date
  }
  slider.value = initialIdx;
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

  document.getElementById('timeline-reset').addEventListener('click', () => {
    slider.value = sortedDates.length - 1;
    dateLabel.textContent = 'Latest';
    setState({ timelineDate: null });
  });

  // Any change to `timelineDate` (slider, reset, popstate, URL load)
  // re-renders the map. The slider input handler itself doesn't need
  // to call updateMap — this subscription is the single write seam.
  on('timelineDate', (date) => {
    updateMap(scoresForDate(date));

    // Also keep the slider position and label in sync when the change
    // comes from elsewhere (popstate / URL). The input handler would
    // otherwise read its own value as stale on external writes.
    const idx = date ? sortedDates.indexOf(date) : sortedDates.length - 1;
    if (idx >= 0 && parseInt(slider.value) !== idx) {
      slider.value = idx;
      dateLabel.textContent = idx === sortedDates.length - 1 ? 'Latest' : sortedDates[idx];
    }
  });
}
