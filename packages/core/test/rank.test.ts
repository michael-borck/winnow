import { describe, expect, it } from 'vitest';
import type { MergedCandidate, RetrievedCandidate, VerificationRecord } from '../src/types.js';
import {
  CRITICAL_TERMS,
  counterQuery,
} from '../src/pipeline/search.js';
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

describe('counterQuery', () => {
  it('appends the critical terms to the topic', () => {
    const query = counterQuery('retrieval augmented generation');
    expect(query).toContain('retrieval augmented generation limitations OR critique');
    expect(query).toContain('"replication failure"');
    expect(CRITICAL_TERMS).toContain('criticism');
  });
});

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

  it('merges the same title, author and year across DOIs and keeps the alternate DOI', () => {
    const title = 'A study of retrieval augmented generation';
    const merged = dedupeCandidates([
      candidate('doi:10.1/a', 'openalex', 1, {
        title,
        type: 'journal-article',
      }),
      candidate('doi:10.1/b', 'crossref', 2, {
        title,
        type: 'journal-article',
        abstract: 'A much longer abstract.',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(['10.1/a', '10.1/b']).toContain(merged[0]!.source.doi);
    expect(merged[0]!.source.alternateDois).toHaveLength(1);
    expect(merged[0]!.providers).toHaveLength(2);
  });

  it('links a preprint and its published version instead of merging them', () => {
    const title = 'A study of retrieval augmented generation';
    const merged = dedupeCandidates([
      candidate('doi:10.1/preprint', 'openalex', 1, {
        title,
        year: 2023,
        type: 'preprint',
        sourceProvider: 'arxiv',
      }),
      candidate('doi:10.1/published', 'crossref', 2, {
        title,
        year: 2024,
        type: 'journal-article',
        venue: 'Journal of Testing',
      }),
    ]);

    expect(merged).toHaveLength(2);
    const canonical = merged.find(
      (item) => item.source.doi === '10.1/published',
    )!;
    const variant = merged.find(
      (item) => item.source.doi === '10.1/preprint',
    )!;

    expect(canonical.source.isVersionOfRecord).toBe(true);
    expect(canonical.source.variantOf).toBeUndefined();
    expect(variant.source.isVersionOfRecord).toBe(false);
    expect(variant.source.variantOf).toBe(canonical.source.id);
    expect(canonical.source.workKey).toBe(variant.source.workKey);
  });

  it('does not merge a preprint and a journal article from the same year', () => {
    const title = 'A study of retrieval augmented generation';
    const merged = dedupeCandidates([
      candidate('doi:10.1/preprint', 'openalex', 1, {
        title,
        year: 2024,
        type: 'preprint',
        sourceProvider: 'arxiv',
      }),
      candidate('doi:10.1/published', 'crossref', 2, {
        title,
        year: 2024,
        type: 'journal-article',
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(
      merged.filter((item) => item.source.isVersionOfRecord === true),
    ).toHaveLength(1);
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
