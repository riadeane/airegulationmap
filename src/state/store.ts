import type { AttributeKey } from '../constants';
import type { ScoreData, RegulationData } from '../data/loader';
import type { HistoryData } from '../data/history';
import type { BlocsData } from '../data/blocs';
import type { SubscoresData } from '../data/subscores';

export interface AppState {
  currentAttribute: AttributeKey;
  scoreData: ScoreData;
  regulationData: RegulationData;
  filterMin: number;
  filterMax: number;
  selectedCountry: string | null;
  sortedCountryNames: string[];
  comparisonCountries: string[];
  // null = "latest" (use current scoreData as-is); otherwise an ISO date
  // string (YYYY-MM-DD) present in history.json. The timeline slider
  // writes this; the map subscribes and re-renders historic scores.
  timelineDate: string | null;
  // Parsed history.json — loaded async after first paint; null until
  // then (and stays null if the fetch fails).
  history: HistoryData | null;
  // Bloc filter: key into blocsData ("EU", "G20", …) or null for all.
  selectedBloc: string | null;
  // Parsed blocs.json — loaded async; null until then / on failure.
  blocsData: BlocsData | null;
  // Parsed subscores.json (methodology v2 sub-indicator audit trail) —
  // loaded async; null until then / on failure.
  subscores: SubscoresData | null;
  // Scatter plot ("dimension explorer") panel state.
  scatterOpen: boolean;
  scatterX: AttributeKey;
  scatterY: AttributeKey;
}

const state: AppState = {
  currentAttribute: 'averageScore',
  scoreData: {},
  regulationData: {},
  filterMin: 1,
  filterMax: 5,
  selectedCountry: null,
  sortedCountryNames: [],
  comparisonCountries: [],
  timelineDate: null,
  history: null,
  selectedBloc: null,
  blocsData: null,
  subscores: null,
  scatterOpen: false,
  scatterX: 'enforcementLevel',
  scatterY: 'regulationStatus',
};

type AnyListener = (value: unknown) => void;
const listeners = new Map<keyof AppState, Set<AnyListener>>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  for (const key of Object.keys(patch) as (keyof AppState)[]) {
    emit(key, state[key]);
  }
}

/** Subscribe to changes of one state key. Returns an unsubscribe function. */
export function on<K extends keyof AppState>(
  event: K,
  handler: (value: AppState[K]) => void
): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  const set = listeners.get(event) as Set<AnyListener>;
  set.add(handler as AnyListener);
  return () => set.delete(handler as AnyListener);
}

function emit(event: keyof AppState, value: unknown): void {
  const handlers = listeners.get(event);
  if (handlers) {
    for (const fn of handlers) fn(value);
  }
}
