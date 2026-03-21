export const WIDTH = 1000;
export const HEIGHT = 500;

export const ATTRIBUTE_LABELS = {
  averageScore: 'Average Score',
  regulationStatus: 'Regulation Status',
  policyLever: 'Policy Lever',
  governanceType: 'Governance Type',
  actorInvolvement: 'Actor Involvement',
  enforcementLevel: 'Enforcement Level',
};

export const LEGEND_ENDPOINTS = {
  averageScore:     ['Minimal', 'Comprehensive'],
  regulationStatus: ['Minimal', 'Comprehensive'],
  policyLever:      ['Narrow', 'Broad'],
  governanceType:   ['Centralized', 'Distributed'],
  actorInvolvement: ['Limited', 'Broad'],
  enforcementLevel: ['Weak', 'Strong'],
};

export const SCORE_OPTIONS = [
  { value: 'averageScore',     text: 'Average Score' },
  { value: 'regulationStatus', text: 'Regulation Status' },
  { value: 'policyLever',      text: 'Policy Lever' },
  { value: 'governanceType',   text: 'Governance Type' },
  { value: 'actorInvolvement', text: 'Actor Involvement' },
  { value: 'enforcementLevel', text: 'Enforcement Level' },
];

export const PLACEHOLDER_RE = /^(na|n\/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$/i;
