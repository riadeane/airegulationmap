import type { ScoreEntry } from '../data/loader';
import { makeColorScale } from '../map/legend';
import { cssVar } from '../map/cssColors';

// Optional colouriser: maps a score to the fill colour for its dots. When
// omitted the dots fall back to the accent (CSS default).
type ColorFor = (score: number) => string;

export function renderDots(elId: string, score: number | null, colorFor?: ColorFor): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.replaceChildren();
  // Scores carry quarter-point decimals since methodology v2. Fill whole
  // dots up to the integer part, then partially fill the next dot for the
  // fraction — rounding (e.g. 1.75 → two full dots) overstated the score.
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

export function renderScoreBar(avg: number | null): void {
  document.getElementById('average-score')!.textContent = avg != null ? `${avg} / 5` : 'N/A';
  const fill = document.getElementById('overall-bar-fill')!;
  fill.style.width = avg != null ? `${((avg - 1) / 4) * 100}%` : '0%';
  // Colour the fill by where the score lands on the ramp, so it reads the
  // same as the country on the map — instead of the old gradient that
  // always ended in "high/blue" no matter the score.
  fill.style.setProperty('--fill-color', avg != null ? makeColorScale()(avg) : 'transparent');
}

export function renderAllDots(scoreData: ScoreEntry | null | undefined): void {
  const scale = makeColorScale();
  // Normative dimensions carry the same red→blue quality language as the
  // map; the two descriptive dimensions (governance, actor) are NOT a
  // quality scale, so they stay a neutral tone rather than borrow it.
  const quality: ColorFor = (v) => scale(v);
  const neutral: ColorFor = () => cssVar('--text-tertiary');
  renderDots('dots-regulation', scoreData ? scoreData.regulationStatus : null, quality);
  renderDots('dots-policy',     scoreData ? scoreData.policyLever : null, quality);
  renderDots('dots-governance', scoreData ? scoreData.governanceType : null, neutral);
  renderDots('dots-actors',     scoreData ? scoreData.actorInvolvement : null, neutral);
  renderDots('dots-enforcement', scoreData ? scoreData.enforcementLevel : null, quality);
}
