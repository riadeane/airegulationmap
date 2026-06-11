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
    const applicable = snapshots
      .filter(s => s.date <= targetDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (applicable.length > 0) {
      result[country] = applicable[0];
    }
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
