import { csv } from 'd3-fetch';

export async function loadScores() {
  const rows = await csv('/scores.csv', d => ({
    country: d.Country,
    regulationStatus: +d['Regulation Status'] || null,
    policyLever: +d['Policy Lever'] || null,
    governanceType: +d['Governance Type'] || null,
    actorInvolvement: +d['Actor Involvement'] || null,
    averageScore: +d['Average Score'] || null,
    enforcementLevel: d['Enforcement Level'] ? +d['Enforcement Level'] : null,
    lastUpdated: d['Last Updated'] || null,
    dataVersion: +d['Data Version'] || 1,
  }));
  return Object.fromEntries(rows.map(d => [d.country, d]));
}

export async function loadRegulation() {
  const rows = await csv('/regulation_data.csv', d => ({
    country: d.Country,
    regulationStatus: d['Regulation Status'],
    policyLever: d['Policy Lever'],
    governanceType: d['Governance Type'],
    actorInvolvement: d['Actor Involvement'],
    enforcementLevel: d['Enforcement Level'] || null,
    specificLaws: d['Specific Laws'] || null,
    sources: d['Sources'] || null,
    lastUpdated: d['Last Updated'] || null,
    confidence: d['Confidence'] || null,
  }));
  return Object.fromEntries(rows.map(d => [d.country, d]));
}
