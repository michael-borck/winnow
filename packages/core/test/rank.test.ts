import { describe, expect, it } from 'vitest';
import type { MergedCandidate, RetrievedCandidate, VerificationRecord } from '../src/types.js';
import { dedupeCandidates } from '../src/pipeline/dedupe.js';
import { rankCandidates } from '../src/pipeline/rank.js';

const verification: VerificationRecord = {
  identity: 'verified',
  matchCategory: 'exact',
  integrity: ['none_found'],
  linkStatus: 'live',
  completeness: { status: 'complete' },
  confidence: 1,
  provider: 'crossref',
  checkedAt: '2026-11-11T00:00:00.000Z',
  evidence: {},
};

function candidate(
  id: string,
  provider: string,
  rank: number,
  overrides: Partial<RetrievedCandidate['source']> = {},
): RetrievedCandidate {
  return {
    provider,
    providerRank: rank,
    source: {
      id,
      title: `Title ${id}`,
      authors: ['Ada Lovelace'],
      year: 2024,
      doi: id.replace(/^doi:/, ''),
      sourceProvider: provider,
      ...overrides,
    },
  };
}

describe('dedupeCandidates', () => {
  it('merges the same DOI from two providers and keeps both ranks', () => {
    const merged = dedupeCandidates([
      candidate('doi:10.1/a', 'openalex', 1, { abstract: 'short' }),
      candidate('doi:10.1/a', 'crossref', 3, {
        abstract: 'a much longer abstract from crossref',
        citationCount: 12,
        citationProvider: 'crossref',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.providers).toEqual([
      { provider: 'openalex', rank: 1, payloadId: undefined },
      { provider: 'crossref', rank: 3, payloadId: undefined },
    ]);
    expect(merged[0]!.source.abstract).toBe('a much longer abstract from crossref');
    expect(merged[0]!.source.citationCount).toBe(12);
  });

  it('does not merge records without a shared identifier', () => {
    const merged = dedupeCandidates([
      candidate('doi:10.1/a', 'openalex', 1),
      candidate('doi:10.1/b', 'openalex', 2),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('rankCandidates', () => {
  it('fuses provider ranks and selects after recording every candidate', () => {
    const merged: MergedCandidate[] = dedupeCandidates([
      candidate('doi:10.1/a', 'openalex', 1),
      candidate('doi:10.1/a', 'crossref', 2),
      candidate('doi:10.1/b', 'openalex', 2),
      candidate('doi:10.1/c', 'crossref', 1),
    ]);

    const verifications = new Map(merged.map((item) => [item.source.id, verification]));
    const ranked = rankCandidates(merged, verifications, { limit: 2 });

    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.source.doi).toBe('10.1/a');
    expect(ranked[0]!.rrfScore).toBeCloseTo(1 / 61 + 1 / 62);
    expect(ranked[1]!.source.doi).toBe('10.1/c');
    expect(ranked[2]!.source.doi).toBe('10.1/b');
    expect(ranked.filter((item) => item.selected)).toHaveLength(2);
    expect(ranked[2]!.selected).toBe(false);
  });

  it('breaks equal RRF ties by recency, then citations, then title', () => {
    const merged: MergedCandidate[] = dedupeCandidates([
      candidate('doi:10.1/old', 'openalex', 1, { year: 2020 }),
      candidate('doi:10.1/new', 'crossref', 1, { year: 2025 }),
    ]);
    const verifications = new Map(merged.map((item) => [item.source.id, verification]));
    const ranked = rankCandidates(merged, verifications, { limit: 2 });

    expect(ranked[0]!.source.doi).toBe('10.1/new');
  });
});
