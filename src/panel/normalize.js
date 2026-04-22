// Display-time text cleanup for LLM-generated regulation descriptions.
//
// Three conservative passes, each opt-out on guard. If the normalizer
// shrinks the text below 60% of its original length or produces an empty
// string, return the original — better stiff than factually truncated.
//
// CSV data is never modified. Every call is scoped to one free-text field
// at render time in src/panel/sections.js.

import { NORMALIZE_COPY } from '../constants.js';

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

// "Country X has no Y, as of April 2026." → strip the "as of …" clause.
// Only applied when the phrase lives inside the first 80 characters AND
// at least one further sentence follows. Preserves trailing "as of …"
// which often carries legitimate anchoring mid-paragraph.
const LEADING_TEMPORAL_RE = new RegExp(
  `^([\\s\\S]{0,80}?)\\s*(?:,\\s*)?as of (?:${MONTHS}) \\d{4}\\s*(?=[.,])`,
  'i'
);

// Stopwords for the cascading-negation vocabulary-overlap heuristic.
const STOPWORDS = new Set([
  'a','an','the','of','on','in','to','for','and','or','but','at','by','with',
  'is','are','was','were','be','been','being','has','have','had','do','does',
  'did','will','would','can','could','should','as','that','this','these','those',
  'it','its','he','she','they','them','their','there','here','than','then','so',
  'no','not','any','all','some','such','only','also','yet','from','into','over',
  'under','about','through','between','among','per','via','nor','exist','exists'
]);

function tokens(s) {
  return (s.toLowerCase().match(/[a-z][a-z-]+/g) || [])
    .filter(t => !STOPWORDS.has(t) && t.length > 2);
}

function stripLeadingTemporal(text) {
  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceCount < 2) return text;
  return text.replace(LEADING_TEMPORAL_RE, '$1').replace(/^\s*,\s*/, '').trim();
}

// Heuristic: a run of sentences all starting with "No " is redundant if
// every sentence after the first shares ≥2 non-stopword tokens with the
// first. Conservative — genuinely distinct claims fall through.
function sharesVocab(sentences) {
  const firstTokens = new Set(tokens(sentences[0]));
  if (firstTokens.size < 2) return false;
  for (let i = 1; i < sentences.length; i++) {
    const shared = tokens(sentences[i]).filter(w => firstTokens.has(w)).length;
    if (shared < 2) return false;
  }
  return true;
}

function collapseCascadingNegations(text) {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences || sentences.length < 3) return text;

  const out = [];
  let run = [];

  const flushRun = () => {
    if (run.length >= 3 && sharesVocab(run)) {
      out.push('No AI-specific legislation, governance body, or enforcement mechanism exists. ');
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const s of sentences) {
    if (/^\s*No\s/.test(s)) {
      run.push(s);
    } else {
      flushRun();
      out.push(s);
    }
  }
  flushRun();
  return out.join('').trim();
}

function trimLeadingHedges(text) {
  return text
    .replace(/^(Generally|Broadly|Notably|Essentially|Largely),\s*/i, '')
    .replace(/([.!?]\s+)(Generally|Broadly|Notably|Essentially|Largely),\s+/g, '$1');
}

export function normalizeRegulationText(text) {
  if (!NORMALIZE_COPY) return text;
  if (!text || typeof text !== 'string') return text;

  const original = text;
  let out = text;

  out = stripLeadingTemporal(out);
  out = collapseCascadingNegations(out);
  out = trimLeadingHedges(out);

  // Safety rail — never silently chew a claim into nothing.
  if (!out || out.trim().length === 0) return original;
  if (out.length < original.length * 0.6) return original;
  return out;
}
