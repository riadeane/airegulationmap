// CSV / JSON export of the dataset — the whole thing or the current
// filtered view. Researchers feed this straight into R / Python / Excel.
//
// Exports always reflect the LATEST data, even while the timeline is
// scrubbed to a historical date: history snapshots carry scores only,
// so a historical export would silently pair old scores with current
// text descriptions.

import { csvFormat } from 'd3-dsv';
import { getState } from '../state/store';
import { visibleCountrySet } from '../state/selectors';
import type { ScoreEntry, RegulationEntry } from '../data/loader';

function buildExportRows(countries: string[]) {
  const { scoreData, regulationData } = getState();
  return countries.map(name => {
    const scores: Partial<ScoreEntry> = scoreData[name] || {};
    const reg: Partial<RegulationEntry> = regulationData[name] || {};
    return {
      'Country': name,
      'Average Score': scores.averageScore,
      'Regulation Status (Score)': scores.regulationStatus,
      'Policy Lever (Score)': scores.policyLever,
      'Governance Type (Score)': scores.governanceType,
      'Actor Involvement (Score)': scores.actorInvolvement,
      'Enforcement Level (Score)': scores.enforcementLevel,
      'Regulation Status': reg.regulationStatus || '',
      'Policy Lever': reg.policyLever || '',
      'Governance Type': reg.governanceType || '',
      'Actor Involvement': reg.actorInvolvement || '',
      'Enforcement Level': reg.enforcementLevel || '',
      'Specific Laws': reg.specificLaws || '',
      'Sources': reg.sources || '',
      'Confidence': reg.confidence || '',
      'Last Updated': scores.lastUpdated || reg.lastUpdated || '',
    };
  });
}

// Countries passing the active filters — the same visibility predicate the
// map and scatter use (score range AND bloc), so "filtered view" exports
// exactly what the user is looking at. Countries with no score for the
// current attribute are excluded — they're dimmed on the map, and "all
// countries" covers them.
function getFilteredCountries(): string[] {
  return [...visibleCountrySet()].sort();
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// Transient confirmation so the download isn't silent — and so the
// researcher can see which scope (filtered vs all) they actually got.
// Doubles as an aria-live announcement for screen-reader users.
function showToast(message: string): void {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast!.classList.remove('visible'), 2800);
}

function exportData(format: string, allCountries: boolean): void {
  const countries = allCountries
    ? Object.keys(getState().scoreData).sort()
    : getFilteredCountries();
  const rows = buildExportRows(countries);
  const date = new Date().toISOString().slice(0, 10);
  const scope = allCountries ? 'all' : 'filtered';
  if (format === 'csv') {
    downloadFile(csvFormat(rows), `ai-regulation-data-${scope}-${date}.csv`, 'text/csv');
  } else {
    downloadFile(JSON.stringify(rows, null, 2), `ai-regulation-data-${scope}-${date}.json`, 'application/json');
  }
  showToast(
    `Exported ${rows.length} ${rows.length === 1 ? 'country' : 'countries'} · ` +
    `${allCountries ? 'all countries' : 'filtered view'} · ${format.toUpperCase()}`
  );
}

export function initExport(): void {
  const btn = document.getElementById('export-btn');
  const popover = document.getElementById('export-popover');
  if (!btn || !popover) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = popover.classList.toggle('open');
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  });

  popover.addEventListener('click', e => {
    const target = (e.target as Element).closest<HTMLButtonElement>('button[data-format]');
    if (!target) return;
    exportData(target.dataset.format!, target.dataset.scope === 'all');
    popover.classList.remove('open');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  });
}
