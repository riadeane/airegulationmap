/** One timestamped score snapshot from history.json. */
export interface HistorySnapshot {
  date: string;
  regulationStatus: number | null;
  policyLever: number | null;
  governanceType: number | null;
  actorInvolvement: number | null;
  enforcementLevel: number | null;
  averageScore: number | null;
}

export interface HistoryData {
  schema_version: number;
  countries: Record<string, HistorySnapshot[]>;
}

export async function loadHistory(): Promise<HistoryData | null> {
  try {
    const response = await fetch('/history.json');
    if (!response.ok) return null;
    return response.json() as Promise<HistoryData>;
  } catch {
    console.warn('history.json not available, timeline disabled');
    return null;
  }
}

export function buildScoresAtDate(
  history: HistoryData,
  targetDate: string
): Record<string, HistorySnapshot> {
  const result: Record<string, HistorySnapshot> = {};
  for (const [country, snapshots] of Object.entries(history.countries)) {
    if (snapshots.length === 0) continue;
    // Snapshots are change-points — the pipeline only appends a new one
    // when a score actually changes (see history.py) — so they describe a
    // step function. The latest snapshot on or before targetDate holds.
    // Before a country's first snapshot there is no recorded change, so we
    // carry its earliest known state backward rather than dropping it;
    // otherwise countries vanish from the map the moment you scrub past the
    // date they were first researched.
    const ordered = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
    let chosen = ordered[0];
    for (const snapshot of ordered) {
      if (snapshot.date > targetDate) break;
      chosen = snapshot;
    }
    result[country] = chosen;
  }
  return result;
}

export function extractSortedDates(history: HistoryData): string[] {
  const allDates = new Set<string>();
  for (const snapshots of Object.values(history.countries)) {
    for (const s of snapshots) allDates.add(s.date);
  }
  return Array.from(allDates).sort();
}
