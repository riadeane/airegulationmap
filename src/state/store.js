const state = {
  currentAttribute: 'averageScore',
  scoreData: {},
  regulationData: {},
  filterMin: 1,
  filterMax: 5,
  selectedCountry: null,
  sortedCountryNames: [],
  comparisonCountries: [],
  // null = "latest" (use current scoreData as-is); otherwise an ISO date
  // string (YYYY-MM-DD) present in history.json. The timeline slider
  // writes this; the map subscribes and re-renders historic scores.
  timelineDate: null,
  // Parsed history.json — loaded async after first paint; null until
  // then (and stays null if the fetch fails).
  history: null,
  // Bloc filter: key into blocsData ("EU", "G20", …) or null for all.
  selectedBloc: null,
  // Parsed blocs.json — loaded async; null until then / on failure.
  blocsData: null,
  // Scatter plot ("dimension explorer") panel state.
  scatterOpen: false,
  scatterX: 'enforcementLevel',
  scatterY: 'regulationStatus',
};

const listeners = new Map();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const key of Object.keys(patch)) {
    emit(key, state[key]);
  }
}

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

function emit(event, ...args) {
  const handlers = listeners.get(event);
  if (handlers) {
    for (const fn of handlers) fn(...args);
  }
}
