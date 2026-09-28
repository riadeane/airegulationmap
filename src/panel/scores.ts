import type { ScoreEntry } from '../data/loader';
import { INSUFFICIENT_EVIDENCE_LABEL, isInsufficient } from '../constants';
import { makeColorScale } from '../map/ramp';
import { NO_ACTIVITY_TEXT, noGovernanceActivity } from '../data/meaning';

// The five dimension values the dots render. Live rows (ScoreEntry) and
// historical snapshots (HistorySnapshot) both satisfy this structurally,
// so the panel can re-vintage its dots during timeline playback.
type DimensionScores = Pick<
  ScoreEntry,
  'regulationStatus' | 'policyLever' | 'governanceType' | 'actorInvolvement' | 'enforcementLevel'
>;

// Optional colouriser: maps a score to the fill colour for its dots. When
// omitted the dots fall back to the accent (CSS default).
type ColorFor = (score: number) => string;

/**
 * `score` is the dimension value: a number, `null` for "insufficient
 * evidence" (the row exists, the value does not), or `undefined` when the
 * country has no row at all (empty dots, as before).
 */
export function renderDots(elId: string, score: number | null | undefined, colorFor?: ColorFor): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.replaceChildren();
  el.classList.remove('dim-dots-note');
  if (isInsufficient(score)) {
    // No dots: empty dots would read as a score of 0, filled ones as a 1.
    const label = document.createElement('span');
    label.className = 'dim-insufficient';
    label.textContent = INSUFFICIENT_EVIDENCE_LABEL;
    el.appendChild(label);
    return;
  }
  // Scores carry quarter-point decimals since methodology v2. Fill whole
  // dots up to the integer part, then partially fill the next dot for the
  // fraction - rounding (e.g. 1.75 → two full dots) overstated the score.
  const s = score ?? 0;
  const whole = Math.floor(s);
  const frac = s - whole;
  const color = (score != null && colorFor) ? colorFor(score) : null;
  for (let i = 1; i <= 5; i++) {
    const dot = document.createElement('span');
    if (i <= whole) {
      dot.className = 'dim-dot filled';
    } else if (i === whole + 1 && frac > 0) {
      dot.className = 'dim-dot partial';
      dot.style.setProperty('--fill', `${Math.round(frac * 100)}%`);
    } else {
      dot.className = 'dim-dot';
    }
    if (color && (i <= whole || (i === whole + 1 && frac > 0))) {
      dot.style.setProperty('--dot-color', color);
    }
    el.appendChild(dot);
  }
  // The number beside the dots carries the exact value.
  if (score != null) {
    const value = document.createElement('span');
    value.className = 'dim-score-value';
    value.textContent = Number.isInteger(score) ? String(score) : score.toFixed(2);
    el.appendChild(value);
  }
}

// #96, display only: where nothing is in force at all, governance type 1
// would read as "a single national authority". Say what the record shows.
function renderNoActivity(elId: string): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.add('dim-dots-note');
  el.textContent = NO_ACTIVITY_TEXT;
}

/** `avg` is the composite: a number, `null` for "insufficient evidence"
 * (fewer than two normative dimensions scored), `undefined` for no row. */
export function renderScoreBar(avg: number | null | undefined): void {
  document.getElementById('average-score')!.textContent = avg != null
    ? `${avg} / 5`
    : isInsufficient(avg) ? INSUFFICIENT_EVIDENCE_LABEL : 'N/A';
  const fill = document.getElementById('overall-bar-fill')!;
  fill.style.width = avg != null ? `${((avg - 1) / 4) * 100}%` : '0%';
  // Colour the fill by where the score lands on the implementation ramp,
  // so it reads the same as the country on the map.
  fill.style.setProperty('--fill-color', avg != null ? makeColorScale('averageScore')(avg) : 'transparent');
}

export function renderAllDots(scoreData: DimensionScores | null | undefined): void {
  // Each lens in its own ramp, as on the map: implementation in the blue
  // "how much is in force" ramp, governance style in the neutral one.
  const implementation = makeColorScale('regulationStatus');
  const style = makeColorScale('governanceType');
  const impl: ColorFor = (v) => implementation(v);
  const neutral: ColorFor = (v) => style(v);
  // `?.` keeps a missing row `undefined` (empty dots) apart from a null
  // value (insufficient evidence).
  renderDots('dots-regulation', scoreData?.regulationStatus, impl);
  renderDots('dots-policy',     scoreData?.policyLever, impl);
  renderDots('dots-enforcement', scoreData?.enforcementLevel, impl);
  if (noGovernanceActivity(scoreData)) renderNoActivity('dots-governance');
  else renderDots('dots-governance', scoreData?.governanceType, neutral);
  renderDots('dots-actors',     scoreData?.actorInvolvement, neutral);
}
