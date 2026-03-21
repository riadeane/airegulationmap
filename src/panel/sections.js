import { PLACEHOLDER_RE } from '../constants.js';

export function showSection(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

export function cleanRegulationText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (PLACEHOLDER_RE.test(trimmed)) return null;
  if (/^(cf\.|Cf\.)\s/i.test(trimmed) && trimmed.length < 40) return null;
  if (/^idem\b/i.test(trimmed) && trimmed.length < 10) return null;
  return trimmed;
}

const SECTION_MAP = [
  { key: 'regulationStatus', sectionId: 'regulation-section', detailId: 'regulation-details' },
  { key: 'policyLever',      sectionId: 'policy-section',     detailId: 'policy-details' },
  { key: 'governanceType',   sectionId: 'governance-section', detailId: 'governance-details' },
  { key: 'actorInvolvement', sectionId: 'actors-section',     detailId: 'actors-details' },
  { key: 'enforcementLevel', sectionId: 'enforcement-section', detailId: 'enforcement-details' },
];

export function renderTextSections(regData) {
  if (!regData) {
    for (const s of SECTION_MAP) showSection(s.sectionId, false);
    showSection('laws-section', false);
    showSection('sources-section', false);
    document.getElementById('no-details-message').style.display = '';
    return;
  }

  const cleanedTexts = {};
  let hasAny = false;

  for (const s of SECTION_MAP) {
    const text = cleanRegulationText(regData[s.key]);
    cleanedTexts[s.key] = text;
    showSection(s.sectionId, !!text);
    if (text) {
      document.getElementById(s.detailId).textContent = text;
      hasAny = true;
    }
  }

  const lawsText = cleanRegulationText(regData.specificLaws);
  showSection('laws-section', !!lawsText);
  if (lawsText) {
    document.getElementById('specific-laws').textContent = lawsText;
    hasAny = true;
  }

  // Sources
  const sourcesContainer = document.getElementById('sources-list');
  sourcesContainer.replaceChildren();
  const urls = regData.sources
    ? regData.sources.split('|').map(u => u.trim()).filter(u => u && !PLACEHOLDER_RE.test(u))
    : [];

  if (urls.length > 0) {
    for (const [i, url] of urls.entries()) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      try { a.textContent = new URL(url).hostname.replace('www.', ''); }
      catch { a.textContent = `Source ${i + 1}`; }
      li.appendChild(a);
      sourcesContainer.appendChild(li);
    }
    showSection('sources-section', true);
    hasAny = true;
  } else {
    showSection('sources-section', false);
  }

  document.getElementById('no-details-message').style.display = hasAny ? 'none' : '';

  if (regData.confidence === 'low') {
    document.querySelectorAll('#panel-content .panel-section').forEach(s => s.classList.add('low-quality'));
  } else {
    document.querySelectorAll('#panel-content .panel-section').forEach(s => s.classList.remove('low-quality'));
  }
}
