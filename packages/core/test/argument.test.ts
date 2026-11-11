import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  getCurrentStances,
  recordScreeningDecision,
  saveRunSources,
} from '../src/project/db.js';
import { recordExtraction } from '../src/extraction/extraction.js';
import {
  buildArgumentBundle,
  buildArgumentMap,
  checkDraft,
  generateArgumentDraft,
  renderDraftMarkdown,
} from '../src/drafting/drafting.js';
import {
  formatStanceCsv,
  formatStanceJson,
  formatStanceTable,
  importStances,
  loadStanceState,
  parseStances,
  recordStanceDecision,
  suggestStance,
  thesisHash,
} from '../src/stance/stance.js';
import type { RankedSource, VerificationRecord } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-argue-'));
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
  title: string,
  abstract: string,
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
      abstract,
      sourceProvider: 'openalex',
    },
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / (60 + rank),
    rank,
    selected: true,
    providers: [{ provider: 'openalex', rank }],
  };
}

const SUPPORTING = source(
  'doi:10.1/support',
  1,
  'Retrieval improves accuracy',
  'The results show that retrieval improves accuracy and is effective.',
);
const OPPOSING = source(
  'doi:10.1/oppose',
  2,
  'Limits of retrieval',
  'A limitation is that the approach fails to improve accuracy; there is no evidence of benefit.',
);
const UNCLEAR = source(
  'doi:10.1/unclear',
  3,
  'A system description',
  'We describe a retrieval system and its components.',
);

const THESIS = 'Retrieval improves accuracy.';

async function projectWithStances(): Promise<{
  db: ReturnType<typeof initProject> extends Promise<infer P> ? P['db'] : never;
  runId: string;
}> {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  const runId = 'run-argue-1';
  createRun(project.db, { id: runId, query: 'testing', config: {} });
  saveRunSources(project.db, runId, 'testing', [
    SUPPORTING,
    OPPOSING,
    UNCLEAR,
  ]);

  for (const item of [SUPPORTING, OPPOSING, UNCLEAR]) {
    recordScreeningDecision(project.db, {
      runId,
      sourceId: item.source.id,
      decision: 'include',
      relevance: 'core',
      reviewer: 'ada',
    });
    recordExtraction(project.db, {
      runId,
      sourceId: item.source.id,
      field: 'finding',
      value: item.source.abstract!,
      quote: item.source.abstract!,
      reviewer: 'ada',
    });
  }

  recordStanceDecision(project.db, {
    runId,
    sourceId: SUPPORTING.source.id,
    thesis: THESIS,
    label: 'supports',
    reviewer: 'ada',
  });
  recordStanceDecision(project.db, {
    runId,
    sourceId: OPPOSING.source.id,
    thesis: THESIS,
    label: 'opposes',
    reviewer: 'ada',
  });
  recordStanceDecision(project.db, {
    runId,
    sourceId: UNCLEAR.source.id,
    thesis: THESIS,
    label: 'unclear',
    reviewer: 'ada',
  });

  return { db: project.db, runId };
}

describe('suggestStance', () => {
  it('classifies supporting, opposing and unclear abstracts', () => {
    expect(suggestStance(SUPPORTING.source, THESIS).suggestedLabel).toBe(
      'supports',
    );
    expect(suggestStance(OPPOSING.source, THESIS).suggestedLabel).toBe(
      'opposes',
    );
    expect(suggestStance(UNCLEAR.source, THESIS).suggestedLabel).toBe(
      'unclear',
    );
  });

  it('lets a strong critical cue override a supporting word in the same sentence', () => {
    const draft = suggestStance(OPPOSING.source, THESIS);
    expect(draft.suggestedLabel).toBe('opposes');
    expect(draft.rationale).toContain('strong critical cue');
  });
});

describe('stance store', () => {
  it('keeps labels per thesis and append-only', async () => {
    const { db, runId } = await projectWithStances();
    const summary = loadStanceState(db, runId, THESIS);
    expect(summary.counts).toEqual({
      supports: 1,
      opposes: 1,
      mixed: 0,
      unclear: 1,
      unlabelled: 0,
    });

    const other = loadStanceState(db, runId, 'A different thesis.');
    expect(other.counts.unlabelled).toBe(3);
    expect(other.counts.supports).toBe(0);

    recordStanceDecision(db, {
      runId,
      sourceId: SUPPORTING.source.id,
      thesis: THESIS,
      label: 'mixed',
      reviewer: 'ada',
    });
    const latest = getCurrentStances(db, thesisHash(THESIS));
    expect(latest.get(SUPPORTING.source.id)?.label).toBe('mixed');

    db.close();
  });

  it('imports and exports stance labels without importing blank rows', async () => {
    const { db, runId } = await projectWithStances();
    const summary = loadStanceState(db, runId, THESIS);
    const csv = formatStanceCsv(summary);
    expect(csv).toContain('supports');
    expect(parseStances(csv, 'csv')).toHaveLength(3);

    const json = JSON.stringify({
      stances: [{ doi: '10.1/unclear', label: 'mixed', rationale: 'changed' }],
    });
    const parsed = parseStances(json, 'json');
    const imported = importStances(db, runId, THESIS, parsed, 'ada');
    expect(imported.imported).toBe(1);

    const reloaded = loadStanceState(db, runId, THESIS);
    expect(
      reloaded.sources.find((item) => item.source.doi === '10.1/unclear')
        ?.stance,
    ).toBe('mixed');

    expect(formatStanceTable(summary)).toContain('Thesis:');
    const parsedJson = JSON.parse(formatStanceJson(summary)) as {
      counts: { supports: number };
    };
    expect(parsedJson.counts.supports).toBe(1);

    db.close();
  });
});

describe('argument map and draft', () => {
  it('builds a map with both sides and keeps a divided synthesis', async () => {
    const { db, runId } = await projectWithStances();
    const bundle = buildArgumentBundle(db, runId, THESIS, ['finding']);
    expect(bundle.sources.some((item) => item.stance === 'supports')).toBe(true);
    expect(bundle.sources.some((item) => item.stance === 'opposes')).toBe(true);

    const map = buildArgumentMap(bundle, THESIS);
    expect(map.supports).toHaveLength(1);
    expect(map.opposes).toHaveLength(1);
    expect(map.unclear).toHaveLength(1);
    expect(map.strongestSupport?.sourceId).toBe(SUPPORTING.source.id);
    expect(map.strongestOppose?.sourceId).toBe(OPPOSING.source.id);

    const draft = checkDraft(
      bundle,
      generateArgumentDraft(bundle, THESIS, map),
    );
    expect(draft.sentences.every((item) => item.status === 'kept')).toBe(true);
    expect(
      draft.sentences.some(
        (item) => item.type === 'synthesis' && item.text.includes('divided'),
      ),
    ).toBe(true);

    const markdown = renderDraftMarkdown(bundle, draft);
    expect(markdown).toContain('## Argument map');
    expect(markdown).toContain('Strongest supporting');
    expect(markdown).toContain('Strongest opposing');
    expect(markdown).toContain('## Counter-evidence');
    expect(markdown).toContain('(Lovelace, 2024)');

    db.close();
  });

  it('does not let a one-sided source count as a divide', async () => {
    const { db, runId } = await projectWithStances();
    // Relabel the opposing source as supporting, leaving one side only.
    recordStanceDecision(db, {
      runId,
      sourceId: OPPOSING.source.id,
      thesis: THESIS,
      label: 'supports',
      reviewer: 'ada',
    });

    const bundle = buildArgumentBundle(db, runId, THESIS, ['finding']);
    const map = buildArgumentMap(bundle, THESIS);
    const draft = checkDraft(
      bundle,
      generateArgumentDraft(bundle, THESIS, map),
    );
    expect(
      draft.sentences.some(
        (item) => item.type === 'synthesis' && item.text.includes('divided'),
      ),
    ).toBe(false);
    expect(
      draft.sentences.some((item) =>
        item.text.includes('falls on one side'),
      ),
    ).toBe(true);

    db.close();
  });
});
