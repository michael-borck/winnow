import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  loadRunSources,
  recordExtractionValue,
  recordScreeningDecision,
  recordStance,
  saveBrief,
  saveDraft,
  savePayload,
  saveRunSources,
} from '../src/project/db.js';
import type { RankedSource, RetrievalPayload } from '../src/types.js';
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

function payload(body: string, id = 'payload-1'): RetrievalPayload {
  return {
    id,
    provider: 'openalex',
    query: 'testing',
    url: 'https://example.test/works',
    fetchedAt: new Date().toISOString(),
    body,
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
      filters: {
        types: ['article'],
        languages: ['en'],
        since: 2020,
        excludeKeywords: [],
        excludeVenues: [],
        excludeDomains: [],
        excludeTypes: [],
        excludeLanguages: [],
      },
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

  it('stores and loads variant metadata and alternate DOIs', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    createRun(project.db, { id: 'run-1', query: 'one', config: {} });

    const item = source('The first abstract.');
    item.source.workKey = 'work-1';
    item.source.variantOf = 'doi:10.1/a';
    item.source.isVersionOfRecord = false;
    item.source.alternateDois = ['10.1/alt'];
    saveRunSources(project.db, 'run-1', 'one', [item]);

    const stored = loadRunSources(project.db, 'run-1')[0]!;
    expect(stored.source.workKey).toBe('work-1');
    expect(stored.source.variantOf).toBe('doi:10.1/a');
    expect(stored.source.isVersionOfRecord).toBe(false);
    expect(stored.source.alternateDois).toContain('10.1/alt');

    project.db.close();
  });

  it('stores a small payload and records its compressed size', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const db = project.db;
    createRun(db, { id: 'run-1', query: 'testing', config: {} });

    const id = await savePayload(
      db,
      project.root,
      'run-1',
      payload('{"ok":true}'),
    );
    const row = db
      .prepare('SELECT size, path FROM raw_payloads WHERE id = ?')
      .get(id) as { size: number; path: string } | undefined;

    expect(row?.size).toBeGreaterThan(0);
    expect(row?.path).toContain('payloads/');

    db.close();
  });

  it('rejects a payload larger than the per-payload cap', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const db = project.db;
    createRun(db, { id: 'run-1', query: 'testing', config: {} });

    const body = randomBytes(2 * 1024 * 1024 + 1024).toString('base64');
    await expect(
      savePayload(db, project.root, 'run-1', payload(body, 'payload-big')),
    ).rejects.toThrow('per-payload cap');

    db.close();
  });

  it('rejects a payload that would exceed the project cap', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const db = project.db;
    createRun(db, { id: 'run-1', query: 'testing', config: {} });

    db.prepare(
      `INSERT INTO raw_payloads
       (id, run_id, provider, query, url, fetched_at, sha256, compression, path, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'gzip', ?, ?)`,
    ).run(
      'payload-existing',
      'run-1',
      'openalex',
      'testing',
      'https://example.test/works',
      new Date().toISOString(),
      'hash',
      'payloads/existing.json.gz',
      250 * 1024 * 1024 - 10,
    );

    await expect(
      savePayload(db, project.root, 'run-1', payload('{"ok":true}', 'small')),
    ).rejects.toThrow('Project payload storage');

    db.close();
  });

  it('records audit events for decisions and drafts', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const db = project.db;
    createRun(db, { id: 'run-1', query: 'testing', config: {} });
    saveRunSources(db, 'run-1', 'testing', [source('The abstract.')]);

    recordScreeningDecision(db, {
      runId: 'run-1',
      sourceId: 'doi:10.1/repeat',
      decision: 'include',
      relevance: 'core',
      reviewer: 'ada',
    });
    recordExtractionValue(db, {
      runId: 'run-1',
      sourceId: 'doi:10.1/repeat',
      field: 'finding',
      value: 'A finding.',
      reviewer: 'ada',
    });
    recordStance(db, {
      runId: 'run-1',
      sourceId: 'doi:10.1/repeat',
      target: 'thesis',
      targetHash: 'hash',
      label: 'supports',
      reviewer: 'ada',
    });
    saveDraft(db, {
      runId: 'run-1',
      mode: 'review',
      writer: 'template',
      markdown: '# Draft',
      structured: {},
      basis: {},
    });

    const actions = (
      db
        .prepare('SELECT action FROM audit_events ORDER BY at')
        .all() as Array<{ action: string }>
    ).map((row) => row.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        'screening_decision',
        'extraction_confirmed',
        'stance_confirmed',
        'draft_saved',
      ]),
    );

    db.close();
  });
});
