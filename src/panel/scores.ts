import type { ScoreEntry } from '../data/loader';

export function renderDots(elId: string, score: number | null): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.replaceChildren();
  for (let i = 1; i <= 5; i++) {
    const dot = document.createElement('span');
    dot.className = i <= Math.round(score as number) ? 'dim-dot filled' : 'dim-dot';
    el.appendChild(dot);
  }
}

export function renderScoreBar(avg: number | null): void {
  document.getElementById('average-score')!.textContent = avg != null ? `${avg} / 5` : 'N/A';
  document.getElementById('overall-bar-fill')!.style.width =
    avg != null ? `${((avg - 1) / 4) * 100}%` : '0%';
}

export function renderAllDots(scoreData: ScoreEntry | null | undefined): void {
  renderDots('dots-regulation', scoreData ? scoreData.regulationStatus : null);
  renderDots('dots-policy',     scoreData ? scoreData.policyLever : null);
  renderDots('dots-governance', scoreData ? scoreData.governanceType : null);
  renderDots('dots-actors',     scoreData ? scoreData.actorInvolvement : null);
  renderDots('dots-enforcement', scoreData ? scoreData.enforcementLevel : null);
}
