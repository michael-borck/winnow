import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../../core/src/project/project.js';
import {
  createRun,
  recordScreeningDecision,
  saveRunSources,
} from '../../core/src/project/db.js';
import { recordExtraction } from '../../core/src/extraction/extraction.js';
import type { RankedSource } from '../../core/src/types.js';

const cliPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-review-'));
  temporaryDirectories.push(directory);
  return directory;
}

function source(): RankedSource {
  return {
    source: {
      id: 'doi:10.1/a',
      title: 'A study',
      authors: ['Lovelace, Ada'],
      year: 2024,
      venue: 'Journal of Testing',
      type: 'article',
      doi: '10.1/a',
      url: 'https://doi.org/10.1/a',
      abstract: 'The results show that retrieval improves accuracy.',
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
      checkedAt: '2026-11-16T00:00:00.000Z',
      evidence: {},
    },
    citability: 'citable',
    rrfScore: 1 / 61,
    rank: 1,
    selected: true,
    providers: [{ provider: 'openalex', rank: 1 }],
  };
}

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('review remote-model consent', () => {
  it('refuses a remote model endpoint without --allow-remote-model', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    const runId = 'run-review-1';
    createRun(project.db, { id: runId, query: 'testing', config: {} });
    saveRunSources(project.db, runId, 'testing', [source()]);
    recordScreeningDecision(project.db, {
      runId,
      sourceId: 'doi:10.1/a',
      decision: 'include',
      relevance: 'core',
      reviewer: 'ada',
    });
    recordExtraction(project.db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'finding',
      value: 'Retrieval improves accuracy.',
      quote: 'The results show that retrieval improves accuracy.',
      reviewer: 'ada',
    });
    project.db.close();

    const result = await runCli([
      'review',
      project.root,
      '--writer',
      'model',
      '--model',
      'test',
      '--base-url',
      'https://llm.example.com/v1',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Refusing to send model data');
    expect(result.stderr).toContain('--allow-remote-model');
  });
});