import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  getCurrentScreening,
  getLatestSuggestions,
  loadRunSources,
  recordScreeningDecision,
  recordScreeningSuggestion,
  saveRunSources,
} from '../src/project/db.js';
import {
  formatScreeningCsv,
  formatScreeningJson,
  formatScreeningTable,
  importScreeningDecisions,
  loadScreeningState,
  parseScreeningDecisions,
} from '../src/screening/screening.js';
import { suggestScreening } from '../src/screening/suggest.js';
import type { Brief } from '../src/brief/brief.js';
import type { RankedSource, VerificationRecord } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-screen-'));
  temporaryDirectories.push(directory);
  return directory;
}

function verification(
  overrides: Partial<VerificationRecord> = {},
): VerificationRecord {
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
    ...overrides,
  };
}

function source(
  id: string,
  overrides: Partial<RankedSource['source']> = {},
  record: VerificationRecord = verification(),
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
      abstract: 'A measured abstract.',
      sourceProvider: 'openalex',
      ...overrides,
    },
    verification: record,
    citability: 'citable',
    rrfScore: 1 / 61,
    rank: Number(id.slice(-1)) || 1,
    selected: true,
    providers: [{ provider: 'openalex', rank: 1 }],
  };
}

function brief(): Brief {
  return {
    mode: 'review',
    question: 'A question',
    scope: { disciplines: [], languages: [] },
    filters: {
      types: [],
      languages: [],
      excludeKeywords: ['press release'],
      excludeVenues: [],
      excludeDomains: ['example.com'],
      excludeTypes: ['editorial'],
      excludeLanguages: [],
    },
    criteria: { include: [], exclude: [] },
    counter: false,
    raw: '',
  };
}

async function projectWithRun(): Promise<{
  db: ReturnType<typeof initProject> extends Promise<infer P> ? P['db'] : never;
  runId: string;
}> {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  const runId = 'run-screen-1';
  createRun(project.db, { id: runId, query: 'testing', config: {} });
  saveRunSources(project.db, runId, 'testing', [
    source('doi:10.1/a', { rank: 1 }),
    source(
      'doi:10.1/b',
      {
        rank: 2,
        title: 'Press release about things',
        abstract: 'A press release is not evidence.',
        type: 'editorial',
        venue: 'News Site',
        url: 'https://news.example.com/x',
      },
    ),
    source(
      'doi:10.1/c',
      { rank: 3, abstract: undefined, title: 'A third study' },
    ),
  ]);
  return { db: project.db, runId };
}

describe('loadScreeningState', () => {
  it('flags brief exclusions without dropping them by default', async () => {
    const { db, runId } = await projectWithRun();
    const summary = loadScreeningState(db, runId, { brief: brief() });

    expect(summary.sources).toHaveLength(3);
    expect(summary.counts.filteredOut).toBe(1);
    expect(summary.counts.undecided).toBe(3);

    const flagged = summary.sources.find((item) => item.source.doi === '10.1/b');
    expect(flagged?.filterFlags).toEqual([
      'keyword:press release',
      'domain:example.com',
      'type:editorial',
    ]);

    const dropped = loadScreeningState(db, runId, {
      brief: brief(),
      dropExcluded: true,
    });
    expect(dropped.sources).toHaveLength(2);
    expect(dropped.counts.filteredOut).toBe(1);

    db.close();
  });

  it('shows only selected sources unless --all is requested', async () => {
    const { db } = await projectWithRun();
    // Build a separate run with one selected and one unselected source.
    createRun(db, { id: 'run-screen-2', query: 'testing', config: {} });
    saveRunSources(db, 'run-screen-2', 'testing', [
      { ...source('doi:10.1/a', { rank: 1 }), selected: true },
      { ...source('doi:10.1/b', { rank: 2 }), selected: false },
    ]);

    const selected = loadScreeningState(db, 'run-screen-2');
    expect(selected.sources).toHaveLength(1);
    const all = loadScreeningState(db, 'run-screen-2', { all: true });
    expect(all.sources).toHaveLength(2);

    db.close();
  });
});

describe('decisions', () => {
  it('records decisions append-only and exposes the latest state', async () => {
    const { db, runId } = await projectWithRun();

    recordScreeningDecision(db, {
      runId,
      sourceId: 'doi:10.1/a',
      decision: 'include',
      relevance: 'core',
      reviewer: 'ada',
    });
    recordScreeningDecision(db, {
      runId,
      sourceId: 'doi:10.1/c',
      decision: 'exclude',
      reasonCode: 'not_empirical',
      reason: 'No data.',
      reviewer: 'ada',
    });

    let summary = loadScreeningState(db, runId);
    expect(summary.counts).toMatchObject({
      included: 1,
      excluded: 1,
      undecided: 1,
      screened: 2,
    });
    expect(summary.reasons).toEqual([{ reason: 'not_empirical', count: 1 }]);

    const included = summary.sources.find((item) => item.source.doi === '10.1/a');
    expect(included?.relevance).toBe('core');

    // A new decision is a new row; the latest wins.
    recordScreeningDecision(db, {
      runId,
      sourceId: 'doi:10.1/a',
      decision: 'exclude',
      reasonCode: 'off_topic',
      reviewer: 'ada',
    });
    summary = loadScreeningState(db, runId);
    expect(summary.sources.find((item) => item.source.doi === '10.1/a')?.decision).toBe(
      'exclude',
    );
    const rows = db
      .prepare("SELECT COUNT(*) AS count FROM screening WHERE source_id = 'doi:10.1/a'")
      .get() as { count: number };
    expect(rows.count).toBe(2);

    db.close();
  });
});

describe('suggestions', () => {
  it('stores suggestions separately from decisions', async () => {
    const { db, runId } = await projectWithRun();
    const state = loadScreeningState(db, runId, { brief: brief() });
    const flagged = state.sources.find((item) => item.source.doi === '10.1/b')!;
    const draft = suggestScreening(flagged);

    expect(draft.suggestedDecision).toBe('exclude');
    recordScreeningSuggestion(db, {
      runId,
      sourceId: flagged.source.id,
      ...draft,
    });

    const suggestions = getLatestSuggestions(db, runId);
    expect(suggestions.get('doi:10.1/b')?.suggested_decision).toBe('exclude');

    const reloaded = loadScreeningState(db, runId, { brief: brief() });
    const withSuggestion = reloaded.sources.find(
      (item) => item.source.doi === '10.1/b',
    );
    expect(withSuggestion?.suggestion?.decision).toBe('exclude');
    expect(withSuggestion?.decision).toBeUndefined();

    db.close();
  });

  it('suggests pending records as maybe and not-citable records as exclude', () => {
    const pending = source(
      'doi:10.1/p',
      { abstract: 'An abstract.' },
      verification({
        completeness: { status: 'incomplete', service: 'crossref', reason: 'timeout' },
      }),
    );
    const notCitable = source(
      'doi:10.1/n',
      { abstract: 'An abstract.' },
      verification({ identity: 'suspicious' }),
    );

    expect(suggestScreening({ ...pending, citability: 'pending', filterFlags: [] }).suggestedDecision).toBe('maybe');
    expect(
      suggestScreening({ ...notCitable, citability: 'not_citable', filterFlags: [] })
        .suggestedDecision,
    ).toBe('exclude');
  });
});

describe('import and export', () => {
  it('parses CSV and JSON, skips blank decisions, and imports by DOI or source id', async () => {
    const { db, runId } = await projectWithRun();
    const csv = `source_id,doi,decision,relevance,reason_code,reason
doi:10.1/a,,include,core,,great
,10.1/b,exclude,,off_topic,not relevant
doi:10.1/c,,,,
`;
    const parsed = parseScreeningDecisions(csv, 'csv');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ sourceId: 'doi:10.1/a', relevance: 'core' });
    expect(parsed[1]).toMatchObject({ doi: '10.1/b', reasonCode: 'off_topic' });

    const imported = importScreeningDecisions(db, runId, parsed, 'ada');
    expect(imported.imported).toBe(2);
    expect(imported.skipped).toEqual([]);

    const summary = loadScreeningState(db, runId);
    expect(summary.counts.included).toBe(1);
    expect(summary.counts.excluded).toBe(1);

    const json = JSON.stringify({
      decisions: [{ doi: '10.1/c', decision: 'maybe', tags: ['theory'] }],
    });
    const fromJson = parseScreeningDecisions(json, 'json');
    expect(fromJson[0]).toMatchObject({ doi: '10.1/c', tags: ['theory'] });

    const missing = importScreeningDecisions(
      db,
      runId,
      [{ doi: '10.9/missing', decision: 'include' }],
      'ada',
    );
    expect(missing.skipped[0]?.key).toBe('10.9/missing');

    db.close();
  });

  it('round-trips a decision template without treating blank rows as errors', async () => {
    const { db, runId } = await projectWithRun();
    recordScreeningDecision(db, {
      runId,
      sourceId: 'doi:10.1/a',
      decision: 'include',
      relevance: 'supporting',
      reviewer: 'ada',
    });

    const summary = loadScreeningState(db, runId);
    const csv = formatScreeningCsv(summary);
    expect(csv).toContain('source_id');
    expect(csv).toContain('doi:10.1/a');
    const parsed = parseScreeningDecisions(csv, 'csv');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.sourceId).toBe('doi:10.1/a');

    const json = JSON.parse(formatScreeningJson(summary)) as {
      counts: { included: number };
      sources: Array<{ filterFlags: string[] }>;
    };
    expect(json.counts.included).toBe(1);
    expect(json.sources[0]?.filterFlags).toEqual([]);

    expect(formatScreeningTable(summary)).toContain('PRISMA-inspired');
    db.close();
  });
});
