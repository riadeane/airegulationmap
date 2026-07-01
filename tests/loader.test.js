import { describe, it, expect, afterEach } from 'vitest';
import { loadScores } from '../src/data/loader';

// loadScores parses scores.csv via d3-fetch (global fetch). Stub fetch with a
// CSV body to exercise the validation boundary: non-numeric and out-of-range
// cells must become null (not NaN), and a blank country row must be dropped.

const HEADER =
  'Country,Regulation Status,Policy Lever,Governance Type,Actor Involvement,Average Score,Enforcement Level,Last Updated,Data Version';

function stubCsv(body) {
  globalThis.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
}

afterEach(() => { delete globalThis.fetch; });

describe('loadScores validation', () => {
  it('parses a well-formed row', async () => {
    stubCsv(`${HEADER}\nGermany,4,3.5,2,3,3.5,4,2026-06-11,2`);
    const data = await loadScores();
    expect(data.Germany.regulationStatus).toBe(4);
    expect(data.Germany.policyLever).toBe(3.5);
    expect(data.Germany.enforcementLevel).toBe(4);
    expect(data.Germany.dataVersion).toBe(2);
  });

  it('coerces a non-numeric score to null, never NaN', async () => {
    stubCsv(`${HEADER}\nAtlantis,banana,3,2,3,3,4,2026-06-11,1`);
    const { Atlantis } = await loadScores();
    expect(Atlantis.regulationStatus).toBeNull();
    expect(Number.isNaN(Atlantis.regulationStatus)).toBe(false);
  });

  it('rejects out-of-range scores (>5 or <1) as null', async () => {
    stubCsv(`${HEADER}\nOz,9,0,2,3,3,4,2026-06-11,1`);
    const { Oz } = await loadScores();
    expect(Oz.regulationStatus).toBeNull(); // 9 out of [1,5]
    expect(Oz.policyLever).toBeNull();      // 0 out of [1,5]
    expect(Oz.governanceType).toBe(2);
  });

  it('treats an empty score cell as null', async () => {
    stubCsv(`${HEADER}\nNod,,3,2,3,3,4,2026-06-11,1`);
    const { Nod } = await loadScores();
    expect(Nod.regulationStatus).toBeNull();
  });

  it('drops a row with a blank country name', async () => {
    stubCsv(`${HEADER}\n,4,3,2,3,3,4,2026-06-11,1\nRealPlace,4,3,2,3,3,4,2026-06-11,1`);
    const data = await loadScores();
    expect(Object.keys(data)).toEqual(['RealPlace']);
  });

  it('defaults a missing/garbled Data Version to 1', async () => {
    stubCsv(`${HEADER}\nEmpire,4,3,2,3,3,4,2026-06-11,`);
    const { Empire } = await loadScores();
    expect(Empire.dataVersion).toBe(1);
  });
});
