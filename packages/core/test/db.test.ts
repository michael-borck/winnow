import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import { createRun, saveBrief, saveRunSources } from '../src/project/db.js';
import type { RankedSource } from '../src/types.js';
import type { Brief } from '../src/brief/brief.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-db-'));
  temporaryDirectories.push(directory);
  return directory;
}

function source(abstract: string | undefined): RankedSource {
  return {
    source: {
      id: 'doi:10.1/repeat',
      title: 'A repeated source',
      authors: ['Ada Lovelace'],
      year: 2024,
      doi: '10.1/repeat',
      abstract,
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
    providers: [{ provider: 'openalex', rank: 1 }],
  };
}

describe('saveRunSources', () => {
  it('updates a source across runs without cascading away identifiers or text', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);

    createRun(project.db, { id: 'run-1', query: 'one', config: {} });
    saveRunSources(project.db, 'run-1', 'one', [source('The first abstract.')]);

    createRun(project.db, { id: 'run-2', query: 'two', config: {} });
    saveRunSources(project.db, 'run-2', 'two', [source(undefined)]);

    const identifiers = project.db
      .prepare("SELECT value FROM identifiers WHERE source_id = ? AND scheme = 'doi'")
      .all('doi:10.1/repeat') as Array<{ value: string }>;
    const text = project.db
      .prepare('SELECT text FROM source_text WHERE source_id = ?')
      .get('doi:10.1/repeat') as { text: string } | undefined;
    const verifications = project.db
      .prepare('SELECT identity FROM verifications WHERE source_id = ?')
      .all('doi:10.1/repeat') as Array<{ identity: string }>;

    expect(identifiers).toEqual([{ value: '10.1/repeat' }]);
    expect(text?.text).toBe('The first abstract.');
    expect(verifications).toEqual([{ identity: 'verified' }]);

    project.db.close();
  });
});

describe('saveBrief', () => {
  it('stores a parsed brief and is idempotent by content hash', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const brief: Brief = {
      mode: 'review',
      question: 'Does it work?',
      scope: { disciplines: ['education'], languages: ['en'] },
      filters: { types: ['article'], languages: ['en'], since: 2020 },
      criteria: { include: ['measured outcomes'], exclude: ['opinion'] },
      counter: false,
      raw: '---\nquestion: Does it work?\n---\n',
    };

    const first = saveBrief(project.db, brief);
    const second = saveBrief(project.db, brief);
    expect(second).toBe(first);

    const row = project.db
      .prepare('SELECT question, mode, filters_json FROM briefs WHERE id = ?')
      .get(first) as {
      question: string;
      mode: string;
      filters_json: string;
    };

    expect(row.question).toBe('Does it work?');
    expect(row.mode).toBe('review');
    expect(JSON.parse(row.filters_json)).toMatchObject({ since: 2020 });

    project.db.close();
  });
});
