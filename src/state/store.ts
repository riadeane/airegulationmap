import type { AttributeKey, MainView } from '../constants';
import type { ScoreData, RegulationData } from '../data/loader';
import type { HistoryData } from '../data/history';
import type { BlocsData } from '../data/blocs';
import type { SubscoresData } from '../data/subscores';

/** Research-confidence levels as recorded per country in regulation data. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface AppState {
  currentAttribute: AttributeKey;
  scoreData: ScoreData;
  regulationData: RegulationData;
  filterMin: number;
  filterMax: number;
  // Confidence filter: null = all levels; otherwise only countries whose
  // record carries one of the listed levels (unknown confidence excluded).
  filterConfidence: readonly ConfidenceLevel[] | null;
  // Restrict to countries citing at least one official (government/
  // legislature/regulator) source.
  filterOfficialOnly: boolean;
  selectedCountry: string | null;
  // Read-only arrays: the store owns these; consumers replace them via
  // setState (always with a fresh array), never mutate in place. The
  // `readonly` modifier makes an accidental `.push()` a compile error.
  sortedCountryNames: readonly string[];
  // The staged comparison set (0-4). Membership is separate from whether the
  // full comparison VIEW is showing (mainView === 'comparison') — the user
  // builds a set, then opens the comparison deliberately.
  comparisonCountries: readonly string[];
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
  // A COMMITTED full-text search ('' = none). Typing in the search box is
  // ephemeral (dropdown-local); committing ("See all results" / Enter on the
  // row / ?q= deep link) persists the query here, which drives the results
  // list in the panel and keeps the map dimmed to matches while browsing.
  searchQuery: string;
  // Which surface owns the main area: the map, the scatter explorer, or the
  // full comparison view. Exactly one at a time (see MainView).
  mainView: MainView;
  // Scatter plot ("dimension explorer") axis selection. Persist across
  // open/close so reopening restores the last pairing.
  scatterX: AttributeKey;
  scatterY: AttributeKey;
}

const state: AppState = {
  currentAttribute: 'averageScore',
  scoreData: {},
  regulationData: {},
  filterMin: 1,
  filterMax: 5,
  filterConfidence: null,
  filterOfficialOnly: false,
  selectedCountry: null,
  sortedCountryNames: [],
  comparisonCountries: [],
  timelineDate: null,
  history: null,
  selectedBloc: null,
  blocsData: null,
  subscores: null,
  searchQuery: '',
  mainView: 'map',
  scatterX: 'enforcementLevel',
  scatterY: 'regulationStatus',
};

/** A listener for one state key `K`, receiving that key's value type. */
type Listener<K extends keyof AppState> = (value: AppState[K]) => void;

// The Set erases `K` — a heterogeneous "key → Set<Listener<that key>>" map
// isn't expressible in TS — but on()/emit() reassert it at the boundary, so
// every public caller stays fully typed.
const listeners = new Map<keyof AppState, Set<Listener<keyof AppState>>>();

/**
 * The state is exposed to consumers as deeply read-only. All mutation
 * flows through setState(); getState() is a window, not a handle. This
 * is a compile-time contract (zero runtime cost) — it turns an
 * accidental `getState().comparisonCountries.push(...)`, which would
 * silently bypass every listener, into a type error.
 */
export function getState(): Readonly<AppState> {
  return state;
}

/**
 * Merge a patch into the state and notify listeners — but only for keys
 * whose value actually changed. Skipping no-op writes prevents redundant
 * re-renders: several call sites write multiple keys at once (e.g. both
 * filter sliders) even when only one moved, and a bare deselect (Esc)
 * writes selectedCountry:null when it is already null. Comparison is by
 * reference, which is correct here because the store never mutates a
 * non-primitive in place — a changed array/object is always a new one.
 */
export function setState(patch: Partial<AppState>): void {
  const changed: (keyof AppState)[] = [];
  for (const key of Object.keys(patch) as (keyof AppState)[]) {
    if (state[key] !== patch[key]) {
      (state as Record<keyof AppState, unknown>)[key] = patch[key];
      changed.push(key);
    }
  }
  for (const key of changed) emit(key, state[key]);
}

/** Subscribe to changes of one state key. Returns an unsubscribe function. */
export function on<K extends keyof AppState>(event: K, handler: Listener<K>): () => void {
  let set = listeners.get(event);
  if (!set) { set = new Set(); listeners.set(event, set); }
  set.add(handler as Listener<keyof AppState>);
  return () => { set.delete(handler as Listener<keyof AppState>); };
}

function emit<K extends keyof AppState>(event: K, value: AppState[K]): void {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const fn of handlers) (fn as Listener<K>)(value);
}
