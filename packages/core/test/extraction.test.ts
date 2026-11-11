import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  recordExtractionSuggestion,
  recordScreeningDecision,
  saveRunSources,
} from '../src/project/db.js';
import {
  formatEvidenceCsv,
  formatEvidenceJson,
  formatEvidenceTable,
  importExtractionValues,
  loadExtractionState,
  parseExtractionValues,
  recordExtraction,
  suggestExtraction,
} from '../src/extraction/extraction.js';
import type { RankedSource, VerificationRecord } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-extract-'));
  temporaryDirectories.push(directory);
  return directory;
}

function verification(): VerificationRecord {
  return {
    identity: 'verified',
    matchCategory: 'exact',
    integrity: ['none_found'],
    linkStatus: 'no_url',
    completeness: { status: 'complete' },
    confidence: 1,
    provider: 'crossref',
    checkedAt: '2026-11-11T00:00:00.000Z',
    evidence: {},
  };
}

function source(
  id: string,
  rank: number,
  overrides: Partial<RankedSource['source']> = {},
): RankedSource {
  const doi = id.replace(/^doi:/, '');
  return {
    source: {
      id,
      title: `Study ${id}`,
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'Journal of Testing',
      type: 'article',
      doi,
      url: `https://doi.org/${doi}`,
      abstract:
        'We surveyed 120 students in a randomized experiment. The results show that retrieval improves accuracy. A limitation is the small sample. We conclude that verification matters.',
      sourceProvider: 'openalex',
      ...overrides,
    },
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / (60 + rank),
    rank,
    selected: true,
    providers: [{ provider: 'openalex', rank }],
  };
}

async function projectWithIncludedSources(): Promise<{
  db: ReturnType<typeof initProject> extends Promise<infer P> ? P['db'] : never;
  runId: string;
}> {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  const runId = 'run-extract-1';
  createRun(project.db, { id: runId, query: 'testing', config: {} });
  saveRunSources(project.db, runId, 'testing', [
    source('doi:10.1/a', 1),
    source('doi:10.1/b', 2, { abstract: 'A different abstract.' }),
    source('doi:10.1/c', 3, { abstract: 'An undecided abstract.' }),
  ]);

  recordScreeningDecision(project.db, {
    runId,
    sourceId: 'doi:10.1/a',
    decision: 'include',
    relevance: 'core',
    reviewer: 'ada',
  });
  recordScreeningDecision(project.db, {
    runId,
    sourceId: 'doi:10.1/b',
    decision: 'exclude',
    reasonCode: 'off_topic',
    reviewer: 'ada',
  });

  return { db: project.db, runId };
}

describe('suggestExtraction', () => {
  it('extracts a few explainable fields from an abstract', () => {
    const drafts = suggestExtraction(source('doi:10.1/a', 1).source);
    const byField = new Map(drafts.map((draft) => [draft.field, draft]));

    expect(byField.get('population')?.value).toBe('students');
    expect(byField.get('sample')?.value).toBe('120 students');
    expect(byField.get('method')?.value).toContain('surveyed');
    expect(byField.get('finding')?.value).toContain('results show');
    expect(byField.get('limitation')?.value).toContain('limitation');
    expect(byField.get('quote')?.value).toContain('results show');
    expect(byField.get('method')?.method).toBe('heuristic');
  });

  it('returns nothing when there is no abstract', () => {
    expect(
      suggestExtraction(source('doi:10.1/a', 1, { abstract: undefined }).source),
    ).toEqual([]);
  });
});

describe('loadExtractionState', () => {
  it('only includes human-confirmed includes', async () => {
    const { db, runId } = await projectWithIncludedSources();
    const summary = loadExtractionState(db, runId);

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.source.doi).toBe('10.1/a');
    expect(summary.counts.included).toBe(1);
    expect(summary.counts.extracted).toBe(0);
    expect(summary.counts.complete).toBe(0);

    db.close();
  });

  it('keeps confirmed values and suggestions separate, latest confirmation wins', async () => {
    const { db, runId } = await projectWithIncludedSources();

    recordExtractionSuggestion(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'Suggested finding.',
      quote: 'The results show that retrieval improves accuracy.',
      confidence: 0.4,
      method: 'heuristic',
    });

    recordExtraction(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'First confirmed finding.',
      quote: 'The results show that retrieval improves accuracy.',
      reviewer: 'ada',
    });
    recordExtraction(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'Second confirmed finding.',
      quote: 'Second quote.',
      reviewer: 'ada',
    });

    const summary = loadExtractionState(db, runId);
    const row = summary.rows[0]!;
    expect(row.values.finding).toBe('Second confirmed finding.');
    expect(row.quotes.finding).toBe('Second quote.');
    expect(row.suggestions.finding?.value).toBe('Suggested finding.');
    expect(summary.counts.extracted).toBe(1);

    db.close();
  });
});

describe('import and export', () => {
  it('imports only included sources and skips blank or unknown rows', async () => {
    const { db, runId } = await projectWithIncludedSources();

    const csv = `source_id,field,value,quote,reviewer
doi:10.1/a,method,Survey of 120 students.,We surveyed 120 students.,ada
doi:10.1/b,method,Excluded source.,,ada
doi:10.1/a,finding,,,ada
`;
    const values = parseExtractionValues(csv, 'csv');
    expect(values).toHaveLength(2);

    const imported = importExtractionValues(db, runId, values, 'ada');
    expect(imported.imported).toBe(1);
    expect(imported.skipped[0]?.key).toBe('doi:10.1/b');

    const json = JSON.stringify({
      values: [{ doi: '10.1/a', field: 'sample', value: '120 students' }],
    });
    const fromJson = parseExtractionValues(json, 'json');
    expect(fromJson[0]).toMatchObject({ doi: '10.1/a', field: 'sample' });

    const summary = loadExtractionState(db, runId);
    expect(summary.rows[0]?.values.method).toBe('Survey of 120 students.');
    expect(summary.counts.extracted).toBe(1);

    db.close();
  });

  it('exports an evidence table, JSON and a re-importable CSV', async () => {
    const { db, runId } = await projectWithIncludedSources();
    recordExtraction(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'A confirmed finding.',
      quote: 'The results show that retrieval improves accuracy.',
      reviewer: 'ada',
    });
    recordExtractionSuggestion(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'limitation',
      value: 'Suggested limitation.',
      confidence: 0.3,
      method: 'heuristic',
    });

    const summary = loadExtractionState(db, runId);

    const table = formatEvidenceTable(summary);
    expect(table).toContain('A confirmed finding.');
    expect(table).toContain('[suggested] Suggested limitation.');
    expect(table).toContain('Evidence: 1 included');

    const json = JSON.parse(formatEvidenceJson(summary)) as {
      counts: { included: number };
      rows: Array<{ values: Record<string, string> }>;
    };
    expect(json.counts.included).toBe(1);
    expect(json.rows[0]?.values.finding).toBe('A confirmed finding.');

    const csv = formatEvidenceCsv(summary);
    expect(csv).toContain('finding');
    expect(csv).toContain('A confirmed finding.');
    expect(csv).toContain('Suggested limitation.');

    const parsed = parseExtractionValues(csv, 'csv');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'A confirmed finding.',
    });

    db.close();
  });
});
