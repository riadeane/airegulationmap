import { getState } from '../state/store.js';
import { updateMap } from '../map/index.js';
import { buildScoresAtDate, extractSortedDates } from '../data/history.js';

export function initTimeline(history) {
  if (!history) return;

  const sortedDates = extractSortedDates(history);
  if (sortedDates.length <= 1) return;

  const container = document.getElementById('timeline-strip');
  container.style.display = 'block';

  const slider = document.getElementById('timeline-slider');
  slider.max = sortedDates.length - 1;
  slider.value = sortedDates.length - 1;

  const dateLabel = document.getElementById('timeline-date-label');

  slider.addEventListener('input', function () {
    const selectedDate = sortedDates[parseInt(this.value)];
    dateLabel.textContent = selectedDate;
    const historicScores = buildScoresAtDate(history, selectedDate);
    updateMap(historicScores);
  });

  document.getElementById('timeline-reset').addEventListener('click', () => {
    slider.value = sortedDates.length - 1;
    dateLabel.textContent = 'Latest';
    updateMap();
  });
}
