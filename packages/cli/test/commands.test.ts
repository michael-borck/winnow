import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../../core/src/project/project.js';
import {
  createRun,
  finishRun,
  recordScreeningDecision,
  saveDraft,
  saveRunSources,
} from '../../core/src/project/db.js';
import { recordStanceDecision } from '../../core/src/stance/stance.js';
import { recordExtraction } from '../../core/src/extraction/extraction.js';
import {
  buildEvidenceBundle,
  checkDraft,
  generateTemplateDraft,
  renderDraftMarkdown,
} from '../../core/src/drafting/drafting.js';
import type {
  RankedSource,
  VerificationRecord,
} from '../../core/src/types.js';

const cliPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const execFileAsync = promisify(execFile);
const thesis = 'Retrieval improves accuracy.';
const runId = 'run-cli-1';
let parent = '';
let root = '';
let briefPath = '';

function verification(): VerificationRecord {
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
  };
}

function source(
  id: string,
  title: string,
  rank: number,
  selected: boolean,
): RankedSource {
  const doi = id.replace(/^doi:/, '');
  return {
    source: {
      id,
      title,
      authors: ['Lovelace, Ada'],
      year: 2024,
      venue: 'Journal of Testing',
      type: 'article',
      doi,
      url: `https://doi.org/${doi}`,
      abstract: 'The results show that retrieval improves accuracy.',
      sourceProvider: 'openalex',
    },
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / (60 + rank),
    rank,
    selected,
    providers: [{ provider: 'openalex', rank }],
  };
}

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
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

beforeAll(async () => {
  parent = await mkdtemp(path.join(os.tmpdir(), 'winnow-cli-'));
  const project = await initProject('demo', parent);
  root = project.root;
  const db = project.db;
  const a = source('doi:10.1/a', 'A study of retrieval', 1, true);
  const b = source('doi:10.1/b', 'A study of synthesis', 2, false);

  createRun(db, { id: runId, query: 'testing', config: {} });
  saveRunSources(db, runId, 'testing', [a, b]);
  recordScreeningDecision(db, {
    runId,
    sourceId: 'doi:10.1/a',
    decision: 'include',
    relevance: 'core',
    reviewer: 'ada',
  });
  recordScreeningDecision(db, {
    runId,
    sourceId: 'doi:10.1/b',
    decision: 'exclude',
    reasonCode: 'off_topic',
    reviewer: 'ada',
  });
  recordExtraction(db, {
    runId,
    sourceId: 'doi:10.1/a',
    field: 'finding',
    value: 'Retrieval improves accuracy.',
    quote: 'The results show that retrieval improves accuracy.',
    reviewer: 'ada',
  });
  recordStanceDecision(db, {
    runId,
    sourceId: 'doi:10.1/a',
    thesis,
    label: 'supports',
    reviewer: 'ada',
  });

  const bundle = buildEvidenceBundle(db, runId, ['finding']);
  const draft = checkDraft(bundle, generateTemplateDraft(bundle));
  const evidence = draft.sentences.find((item) => item.type === 'evidence');
  if (evidence) {
    evidence.status = 'held';
    evidence.support = {
      label: 'unsupported',
      confidence: 0.9,
      rationale: 'Test hold.',
      model: 'mock',
      method: 'model',
    };
  }
  const markdown = renderDraftMarkdown(bundle, draft, 'apa');
  saveDraft(db, {
    runId,
    mode: 'review',
    writer: 'template',
    markdown,
    structured: draft,
    bundle,
    basis: draft.basis,
  });
  finishRun(db, runId, {
    outputSha256: 'test',
    stages: { retrieve: 'ok' },
    componentHealth: { failed: false },
  });
  db.close();

  briefPath = path.join(parent, 'brief.md');
  await writeFile(
    briefPath,
    '---\nquestion: Does retrieval work?\n---\nContext for the test.\n',
  );
});

afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('CLI project workflows', () => {
  it('parses a brief', async () => {
    const result = await runCli(['brief', briefPath, '--format', 'json']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Does retrieval work?');
  });

  it('runs doctor offline against a project', async () => {
    const result = await runCli([
      'doctor',
      '--project',
      root,
      '--offline',
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      checks: Array<{ name: string; detail: string }>;
    };
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((item) => item.name === 'project')?.detail,
    ).toContain('schema 9');
  });

  it('screens a run', async () => {
    const result = await runCli([
      'screen',
      root,
      '--run',
      runId,
      '--all',
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      sources: Array<{ id: string; decision: string | null }>;
    };
    expect(summary.sources).toHaveLength(2);
    expect(
      summary.sources.find((item) => item.id === 'doi:10.1/a')?.decision,
    ).toBe('include');
  });

  it('extracts confirmed evidence', async () => {
    const result = await runCli([
      'extract',
      root,
      '--run',
      runId,
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      rows: Array<{ values: Record<string, string> }>;
    };
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]!.values.finding).toBe(
      'Retrieval improves accuracy.',
    );
  });

  it('labels stance', async () => {
    const result = await runCli([
      'stance',
      root,
      '--run',
      runId,
      '--thesis',
      thesis,
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      counts: { supports: number };
    };
    expect(summary.counts.supports).toBe(1);
  });

  it('exports sources, evidence and a draft', async () => {
    const sources = await runCli([
      'export',
      root,
      '--run',
      runId,
      '--kind',
      'sources',
      '--format',
      'json',
    ]);
    expect(sources.code).toBe(0);
    const sourceJson = JSON.parse(sources.stdout) as {
      sources: Array<{ id: string }>;
    };
    expect(sourceJson.sources).toHaveLength(1);
    expect(sourceJson.sources[0]!.id).toBe('doi:10.1/a');

    const all = await runCli([
      'export',
      root,
      '--run',
      runId,
      '--kind',
      'sources',
      '--format',
      'json',
      '--all',
    ]);
    expect(all.code).toBe(0);
    const allJson = JSON.parse(all.stdout) as {
      sources: Array<{ id: string }>;
    };
    expect(allJson.sources).toHaveLength(2);

    const evidence = await runCli([
      'export',
      root,
      '--run',
      runId,
      '--kind',
      'evidence',
      '--format',
      'json',
    ]);
    expect(evidence.code).toBe(0);
    const evidenceJson = JSON.parse(evidence.stdout) as {
      rows: Array<{ values: Record<string, string> }>;
    };
    expect(evidenceJson.rows[0]!.values.finding).toBe(
      'Retrieval improves accuracy.',
    );

    const draft = await runCli([
      'export',
      root,
      '--run',
      runId,
      '--kind',
      'draft',
      '--format',
      'markdown',
    ]);
    expect(draft.code).toBe(0);
    expect(draft.stdout).toContain('#');
  });

  it('lists held sentences', async () => {
    const result = await runCli([
      'queue',
      root,
      '--run',
      runId,
      '--format',
      'json',
    ]);
    expect(result.code).toBe(0);
    const queue = JSON.parse(result.stdout) as {
      held: Array<{ id: string }>;
    };
    expect(queue.held).toHaveLength(1);
  });

  it('generates a template review', async () => {
    const result = await runCli([
      'review',
      root,
      '--run',
      runId,
      '--no-save',
      '--format',
      'markdown',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('#');
    expect(result.stdout).toContain('Retrieval improves accuracy.');
  });

  it('generates an argument draft', async () => {
    const result = await runCli([
      'argue',
      root,
      '--run',
      runId,
      '--thesis',
      thesis,
      '--no-save',
      '--format',
      'markdown',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Argument:');
  });
});