import { PLACEHOLDER_RE } from '../constants';
import { maybeEl } from '../dom';
import type { DimensionKey } from '../constants';
import { normalizeRegulationText } from './normalize';
import { classifySources } from '../data/sources';
import type { ClassifiedSource, SourceMeta } from '../data/sources';
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

/**
 * Render a classified source list. When `meta` carries an entry for a URL
 * the link shows the page title instead of the bare hostname (the hostname
 * moves into the secondary line) — the display upgrades automatically as
 * source metadata becomes available.
 */
export function renderSources(
  container: HTMLElement,
  sources: ClassifiedSource[],
  meta?: SourceMeta | null
): void {
  container.replaceChildren();
  for (const source of sources) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = source.url;
    const title = meta?.[source.url]?.title?.trim();
    if (title) {
      a.textContent = title;
      const host = document.createElement('span');
      host.className = 'source-hostname';
      host.textContent = source.hostname;
      li.append(a, host);
    } else {
      a.textContent = source.hostname;
      li.appendChild(a);
    }
    if (source.kind === 'official') {
      const tag = document.createElement('span');
      tag.className = 'source-tag';
      tag.textContent = 'official';
      li.appendChild(tag);
    }
    container.appendChild(li);
  }
}

export function renderTextSections(
  regData: RegulationEntry | null | undefined,
  meta?: SourceMeta | null
): void {
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
  const sources = classifySources(regData.sources);
  renderSources(sourcesContainer, sources, meta);

  const copyBtn = maybeEl<HTMLButtonElement>('sources-copy');
  if (copyBtn) copyBtn.hidden = sources.length === 0;

  if (sources.length > 0) {
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

// Where each searchable field renders. Mirrors SECTION_MAP plus the
// non-dimension Key Legislation field.
const FIELD_TARGETS: Record<string, { sectionId: string; detailId: string }> = {
  ...Object.fromEntries(SECTION_MAP.map(s => [s.key, { sectionId: s.sectionId, detailId: s.detailId }])),
  specificLaws: { sectionId: 'laws-section', detailId: 'specific-laws' },
};

/**
 * Scroll the panel to the section a search match came from and wrap the
 * first occurrence of the query in <mark>, so the reader lands on the
 * sentence that matched instead of eyeballing six prose blocks. The mark is
 * a text-node splice (detail elements hold plain text set via textContent —
 * never innerHTML with data) and is transient: the next render clears it.
 */
export function highlightPanelField(field: string, query: string): void {
  const target = FIELD_TARGETS[field];
  if (!target) return;
  const section = document.getElementById(target.sectionId);
  const detail = document.getElementById(target.detailId);
  if (!section || !detail) return;

  const text = detail.textContent || '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx >= 0) {
    const mark = document.createElement('mark');
    mark.className = 'panel-field-mark';
    mark.textContent = text.slice(idx, idx + query.length);
    detail.replaceChildren(
      document.createTextNode(text.slice(0, idx)),
      mark,
      document.createTextNode(text.slice(idx + query.length))
    );
  }
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
