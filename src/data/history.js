export async function loadHistory() {
  try {
    const response = await fetch('/history.json');
    if (!response.ok) return null;
    return response.json();
  } catch {
    console.warn('history.json not available, timeline disabled');
    return null;
  }
}

export function buildScoresAtDate(history, targetDate) {
  const result = {};
  for (const [country, snapshots] of Object.entries(history.countries)) {
    const applicable = snapshots
      .filter(s => s.date <= targetDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (applicable.length > 0) {
      result[country] = applicable[0];
    }
  }
  return result;
}

export function extractSortedDates(history) {
  const allDates = new Set();
  for (const snapshots of Object.values(history.countries)) {
    for (const s of snapshots) allDates.add(s.date);
  }
  return Array.from(allDates).sort();
}
