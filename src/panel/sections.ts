import { PLACEHOLDER_RE } from '../constants';
import type { DimensionKey } from '../constants';
import { normalizeRegulationText } from './normalize';
import { classifySources } from '../data/sources';
import type { RegulationEntry } from '../data/loader';

export function showSection(id: string, show: boolean): void {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

export function cleanRegulationText(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (PLACEHOLDER_RE.test(trimmed)) return null;
  if (/^(cf\.|Cf\.)\s/i.test(trimmed) && trimmed.length < 40) return null;
  if (/^idem\b/i.test(trimmed) && trimmed.length < 10) return null;
  return normalizeRegulationText(trimmed);
}

const SECTION_MAP: { key: DimensionKey; sectionId: string; detailId: string }[] = [
  { key: 'regulationStatus', sectionId: 'regulation-section', detailId: 'regulation-details' },
  { key: 'policyLever',      sectionId: 'policy-section',     detailId: 'policy-details' },
  { key: 'governanceType',   sectionId: 'governance-section', detailId: 'governance-details' },
  { key: 'actorInvolvement', sectionId: 'actors-section',     detailId: 'actors-details' },
  { key: 'enforcementLevel', sectionId: 'enforcement-section', detailId: 'enforcement-details' },
];

export function renderTextSections(regData: RegulationEntry | null | undefined): void {
  if (!regData) {
    for (const s of SECTION_MAP) showSection(s.sectionId, false);
    showSection('laws-section', false);
    showSection('sources-section', false);
    document.getElementById('no-details-message')!.style.display = '';
    return;
  }

  const cleanedTexts: Partial<Record<DimensionKey, string | null>> = {};
  let hasAny = false;

  for (const s of SECTION_MAP) {
    const text = cleanRegulationText(regData[s.key]);
    cleanedTexts[s.key] = text;
    showSection(s.sectionId, !!text);
    if (text) {
      document.getElementById(s.detailId)!.textContent = text;
      hasAny = true;
    }
  }

  const lawsText = cleanRegulationText(regData.specificLaws);
  showSection('laws-section', !!lawsText);
  if (lawsText) {
    document.getElementById('specific-laws')!.textContent = lawsText;
    hasAny = true;
  }

  // Sources — official (government/legislature/regulator) sources get
  // a tag so analysts can spot primary-source coverage at a glance.
  const sourcesContainer = document.getElementById('sources-list')!;
  sourcesContainer.replaceChildren();
  const sources = classifySources(regData.sources);

  const copyBtn = document.getElementById('sources-copy') as HTMLButtonElement | null;
  if (copyBtn) copyBtn.hidden = sources.length === 0;

  if (sources.length > 0) {
    for (const source of sources) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = source.url;
      a.textContent = source.hostname;
      li.appendChild(a);
      if (source.kind === 'official') {
        const tag = document.createElement('span');
        tag.className = 'source-tag';
        tag.textContent = 'official';
        li.appendChild(tag);
      }
      sourcesContainer.appendChild(li);
    }
    showSection('sources-section', true);
    hasAny = true;
  } else {
    showSection('sources-section', false);
  }

  document.getElementById('no-details-message')!.style.display = hasAny ? 'none' : '';

  if (regData.confidence === 'low') {
    document.querySelectorAll('#panel-content .panel-section').forEach(s => s.classList.add('low-quality'));
  } else {
    document.querySelectorAll('#panel-content .panel-section').forEach(s => s.classList.remove('low-quality'));
  }
}
