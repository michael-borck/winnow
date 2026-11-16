import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  finishRun,
  saveRunSources,
  type RunRow,
} from '../src/project/db.js';
import {
  compareRerun,
  formatRerunReport,
  rerunRun,
} from '../src/pipeline/rerun.js';
import { hashSnapshot, snapshotForRankedSources } from '../src/replay.js';
import { isCitable } from '../src/verification/citability.js';
import type {
  ProviderFailure,
  RankedSource,
  SearchResult,
  VerificationRecord,
} from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-rerun-'));
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
    checkedAt: '2026-11-16T00:00:00.000Z',
    evidence: {},
    ...overrides,
  };
}

function source(
  id: string,
  rank: number,
  overrides: Partial<RankedSource> = {},
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
      abstract: 'The results show that retrieval improves accuracy.',
      sourceProvider: 'openalex',
    },
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / (60 + rank),
    rank,
    selected: true,
    providers: [{ provider: 'openalex', rank }],
    ...overrides,
  };
}

function makeRun(
  sources: RankedSource[],
  overrides: Partial<RunRow> = {},
): RunRow {
  return {
    id: 'run-stored',
    project_id: null,
    started_at: '2026-11-16T00:00:00.000Z',
    finished_at: '2026-11-16T00:00:01.000Z',
    query: 'testing',
    config_json: JSON.stringify({
      limit: 20,
      providers: 'openalex,crossref',
    }),
    stages_json: '{}',
    component_health_json: '{}',
    output_sha256: hashSnapshot(
      snapshotForRankedSources('run-stored', 'testing', sources),
    ),
    status: 'ok',
    ...overrides,
  };
}

function liveResult(
  sources: RankedSource[],
  failures: ProviderFailure[] = [],
): SearchResult {
  return {
    runId: 'run-live',
    query: 'testing',
    startedAt: '2026-11-16T00:00:02.000Z',
    finishedAt: '2026-11-16T00:00:03.000Z',
    retrieved: sources.length,
    unique: sources.length,
    selectedCount: sources.filter((item) => item.selected).length,
    citableCount: sources.filter((item) => isCitable(item.citability)).length,
    sources,
    failures,
    payloads: [],
  };
}

describe('compareRerun', () => {
  it('reports an identical live result', () => {
    const a = source('doi:10.1/a', 1);
    const b = source('doi:10.1/b', 2);
    const stored = [a, b];
    const result = compareRerun(makeRun(stored), stored, liveResult([a, b]));

    expect(result.identical).toBe(true);
    expect(result.hashMatches).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.changed).toBe(0);
  });

  it('reports added, removed, rank and selection changes', () => {
    const a = source('doi:10.1/a', 1);
    const b = source('doi:10.1/b', 2);
    const c = source('doi:10.1/c', 1);
    const stored = [a, b];
    const liveA = { ...a, rank: 2, selected: false };
    const result = compareRerun(
      makeRun(stored),
      stored,
      liveResult([c, liveA]),
    );

    expect(result.identical).toBe(false);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.changed).toBe(1);
    expect(
      result.sources.find((item) => item.id === 'doi:10.1/a')?.changes,
    ).toContain('rank 1 -> 2');
    expect(
      result.sources.find((item) => item.id === 'doi:10.1/a')?.changes,
    ).toContain('selected true -> false');
    expect(
      result.sources.find((item) => item.id === 'doi:10.1/b')?.status,
    ).toBe('removed');
    expect(
      result.sources.find((item) => item.id === 'doi:10.1/c')?.status,
    ).toBe('added');
  });

  it('reports citability and verification drift', () => {
    const a = source('doi:10.1/a', 1);
    const changed = {
      ...a,
      source: { ...a.source, title: 'Study doi:10.1/a revised', year: 2025 },
      citability: 'pending' as const,
      verification: verification({
        identity: 'unverified',
        matchCategory: 'none',
        completeness: {
          status: 'incomplete',
          service: 'crossref',
          reason: 'timeout',
        },
        confidence: 0,
      }),
    };
    const result = compareRerun(
      makeRun([a]),
      [a],
      liveResult([changed]),
    );

    expect(result.identical).toBe(false);
    expect(result.changed).toBe(1);
    expect(result.sources[0]?.changes).toContain(
      'citability citable -> pending',
    );
    expect(result.sources[0]?.changes).toContain('title changed');
    expect(result.sources[0]?.changes).toContain('year 2024 -> 2025');
    expect(result.sources[0]?.changes).toContain(
      'identity verified -> unverified',
    );
    expect(result.sources[0]?.changes).toContain(
      'completeness complete -> incomplete',
    );
  });

  it('marks a missing stored hash as a problem', () => {
    const a = source('doi:10.1/a', 1);
    const result = compareRerun(
      makeRun([a], { output_sha256: null }),
      [a],
      liveResult([a]),
    );

    expect(result.hashMatches).toBeNull();
    expect(result.identical).toBe(false);
    expect(result.problems).toContain('Stored run has no output hash');
  });

  it('formats a summary and a detailed diff', () => {
    const a = source('doi:10.1/a', 1);
    const b = source('doi:10.1/b', 2);
    const c = source('doi:10.1/c', 1);
    const result = compareRerun(
      makeRun([a, b]),
      [a, b],
      liveResult([c]),
    );

    const summary = formatRerunReport(result);
    expect(summary).toContain('Identical: no');
    expect(summary).toContain('Changes: 1 added, 2 removed, 0 changed');
    expect(summary).toContain('Use --diff');

    const detail = formatRerunReport(result, { diff: true });
    expect(detail).toContain('+ doi:10.1/c');
    expect(detail).toContain('- doi:10.1/a');
    expect(detail).toContain('- doi:10.1/b');
  });
});

describe('rerunRun', () => {
  it('executes through the injected runner and records an audit event', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const runId = 'run-stored';
    const a = source('doi:10.1/a', 1);
    const b = source('doi:10.1/b', 2);

    createRun(project.db, { id: runId, query: 'testing', config: {} });
    saveRunSources(project.db, runId, 'testing', [a, b]);
    finishRun(project.db, runId, {
      outputSha256: hashSnapshot(
        snapshotForRankedSources(runId, 'testing', [a, b]),
      ),
      stages: { retrieve: 'ok' },
      componentHealth: { failed: false },
    });

    const result = await rerunRun(project.db, runId, {
      execute: async () => liveResult([a, b]),
    });

    expect(result.identical).toBe(true);
    const event = project.db
      .prepare(
        "SELECT action, payload_json FROM audit_events WHERE run_id = ? AND action = 'rerun_live'",
      )
      .get(runId) as { action: string; payload_json: string } | undefined;

    expect(event?.action).toBe('rerun_live');
    expect(JSON.parse(event!.payload_json)).toMatchObject({
      liveRunId: 'run-live',
      identical: true,
      added: 0,
      removed: 0,
      changed: 0,
    });

    project.db.close();
  });

  it('rejects a missing run', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);

    await expect(rerunRun(project.db, 'missing')).rejects.toThrow(
      'Run not found: missing',
    );

    project.db.close();
  });
});
