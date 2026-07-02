// Verified policy initiatives for the selected country, from the
// policy_initiatives table (OECD.AI Policy Navigator / GAIIN records).
// This is the transparency layer for evidence-grounded scoring: the reader
// sees the same records the research prompt was grounded in.
//
// Pure progressive enhancement: the section renders only when the fetch
// succeeds AND returns rows; otherwise it stays hidden and the panel reads
// exactly as before. Responses are cached per country for the session.

import { getState, on } from '../state/store';
import { restGet, isConfigured } from '../data/supabase';
import { showSection } from './sections';

interface Initiative {
  name: string;
  start_year: number | null;
  initiative_type: string | null;
  binding: string | null;
  status: string | null;
  source_url: string | null;
  first_synced: string | null;
}

const cache = new Map<string, Initiative[]>();
// Guards against out-of-order responses when the user flips countries
// faster than fetches resolve.
let renderSeq = 0;

async function initiativesFor(country: string): Promise<Initiative[]> {
  const cached = cache.get(country);
  if (cached) return cached;
  const rows = await restGet(
    'policy_initiatives?select=name,start_year,initiative_type,binding,status,source_url,first_synced,'
    + `countries!inner(name)&countries.name=eq.${encodeURIComponent(country)}`
    + '&order=start_year.desc.nullslast&limit=50'
  );
  const initiatives = Array.isArray(rows) ? (rows as Initiative[]).filter(r => r.name) : [];
  cache.set(country, initiatives);
  return initiatives;
}

function render(list: HTMLElement, attribution: HTMLElement, initiatives: Initiative[]): void {
  list.replaceChildren();
  for (const init of initiatives) {
    const li = document.createElement('li');

    const name = document.createElement(init.source_url ? 'a' : 'span');
    name.className = 'initiative-name';
    name.textContent = init.name;
    if (init.source_url && name instanceof HTMLAnchorElement) {
      name.href = init.source_url;
      name.target = '_blank';
      name.rel = 'noopener noreferrer';
    }

    const metaParts = [
      init.start_year != null ? String(init.start_year) : null,
      init.initiative_type,
      init.binding,
      init.status,
    ].filter(Boolean);
    const meta = document.createElement('span');
    meta.className = 'initiative-meta';
    meta.textContent = metaParts.join(' · ');

    li.append(name, meta);
    list.appendChild(li);
  }

  // Attribution required by the OECD terms of use.
  const synced = initiatives.map(i => i.first_synced).filter(Boolean).sort()[0];
  const accessed = synced ? synced.slice(0, 10) : '';
  attribution.textContent =
    `Includes data from the OECD.AI Policy Observatory (GAIIN)${accessed ? `, accessed ${accessed}` : ''}. `
    + 'Records are shown as received; scores may draw on additional sources.';
}

export function initInitiatives(): void {
  const list = document.getElementById('initiatives-list');
  const attribution = document.getElementById('initiatives-attribution');
  if (!list || !attribution || !isConfigured()) return;

  on('selectedCountry', async (country) => {
    const seq = ++renderSeq;
    showSection('initiatives-section', false);
    if (!country) return;

    const initiatives = await initiativesFor(country);
    // A newer selection superseded this fetch, or the country changed.
    if (seq !== renderSeq || getState().selectedCountry !== country) return;
    if (initiatives.length === 0) return;

    render(list, attribution, initiatives);
    showSection('initiatives-section', true);
  });
}
