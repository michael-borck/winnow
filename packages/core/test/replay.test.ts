import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  finishRun,
  savePayload,
  saveRunSources,
} from '../src/project/db.js';
import { buildSnapshot, hashSnapshot, replayRun } from '../src/replay.js';
import type { RankedSource, RetrievalPayload } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-replay-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('replay', () => {
  it('re-derives the stored snapshot and detects payload corruption', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const runId = 'run-test-001';
    const payload: RetrievalPayload = {
      id: 'payload-test-001',
      provider: 'openalex',
      query: 'testing',
      url: 'https://example.test/works',
      fetchedAt: '2026-11-11T00:00:00.000Z',
      body: '{"results":[]}',
    };

    createRun(project.db, { id: runId, query: 'testing', config: {} });
    await savePayload(project.db, project.root, runId, payload);

    const source: RankedSource = {
      source: {
        id: 'doi:10.1/test',
        title: 'A test paper',
        authors: ['Ada Lovelace'],
        year: 2024,
        doi: '10.1/test',
        sourceProvider: 'openalex',
      },
      verification: {
        identity: 'verified',
        matchCategory: 'exact',
        integrity: ['none_found'],
        linkStatus: 'no_url',
        completeness: { status: 'complete' },
        confidence: 1,
        provider: 'crossref',
        checkedAt: '2026-11-11T00:00:00.000Z',
        evidence: {},
      },
      citability: 'citable',
      rrfScore: 1 / 61,
      rank: 1,
      selected: true,
      providers: [{ provider: 'openalex', rank: 1, payloadId: payload.id }],
    };

    saveRunSources(project.db, runId, 'testing', [source]);
    const snapshot = buildSnapshot(runId, 'testing', [source]);
    finishRun(project.db, runId, {
      outputSha256: hashSnapshot(snapshot),
      stages: {},
      componentHealth: { failed: false },
    });

    const first = await replayRun(project.db, project.root, runId);
    expect(first.ok).toBe(true);
    expect(first.problems).toEqual([]);

    const payloadRow = project.db
      .prepare('SELECT path FROM raw_payloads WHERE id = ?')
      .get(payload.id) as { path: string };
    const payloadPath = path.join(project.root, payloadRow.path);
    await writeFile(payloadPath, 'not gzip');

    const tampered = await replayRun(project.db, project.root, runId);
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(' ')).toContain('unreadable');

    project.db.close();
  });
});
