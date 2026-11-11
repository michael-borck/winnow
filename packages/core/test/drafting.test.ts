import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  getDraft,
  recordScreeningDecision,
  saveDraft,
  saveRunSources,
} from '../src/project/db.js';
import { recordExtraction } from '../src/extraction/extraction.js';
import {
  buildEvidenceBundle,
  checkDraft,
  generateTemplateDraft,
  renderDraftMarkdown,
  type StructuredDraft,
} from '../src/drafting/drafting.js';
import type { RankedSource, VerificationRecord } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-draft-'));
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

function source(): RankedSource {
  return {
    source: {
      id: 'doi:10.1/a',
      title: 'A study of retrieval',
      authors: ['Lovelace, Ada'],
      year: 2024,
      venue: 'Journal of Testing',
      type: 'article',
      doi: '10.1/a',
      url: 'https://doi.org/10.1/a',
      abstract:
        'We surveyed 120 students in a randomized experiment. The results show that retrieval improves accuracy. A limitation is the small sample.',
      sourceProvider: 'openalex',
    },
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / 61,
    rank: 1,
    selected: true,
    providers: [{ provider: 'openalex', rank: 1 }],
  };
}

async function projectWithEvidence(): Promise<{
  db: ReturnType<typeof initProject> extends Promise<infer P> ? P['db'] : never;
  runId: string;
}> {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  const runId = 'run-draft-1';
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
    value: 'The results show that retrieval improves accuracy.',
    quote: 'The results show that retrieval improves accuracy.',
    reviewer: 'ada',
  });
  recordExtraction(project.db, {
    runId,
    sourceId: 'doi:10.1/a',
    field: 'sample',
    value: '120 students',
    quote: 'We surveyed 120 students in a randomized experiment.',
    reviewer: 'ada',
  });
  recordExtraction(project.db, {
    runId,
    sourceId: 'doi:10.1/a',
    field: 'method',
    value: 'We surveyed 120 students in a randomized experiment.',
    quote: 'We surveyed 120 students in a randomized experiment.',
    reviewer: 'ada',
  });

  return { db: project.db, runId };
}

function customDraft(
  bundle: ReturnType<typeof buildEvidenceBundle>,
  sentence: StructuredDraft['sentences'][number],
): StructuredDraft {
  return {
    id: 'draft-test',
    runId: bundle.runId,
    mode: 'review',
    writer: 'template',
    title: 'Test',
    sentences: [sentence],
    createdAt: '2026-11-11T00:00:00.000Z',
    basis: bundle.counts,
  };
}

describe('buildEvidenceBundle', () => {
  it('builds claims from confirmed extractions with quotes', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, [
      'finding',
      'sample',
      'method',
    ]);

    expect(bundle.claims).toHaveLength(3);
    expect(bundle.counts).toEqual({ included: 1, withEvidence: 1, claims: 3 });
    expect(bundle.sources[0]?.abstract).toContain('We surveyed');
    expect(bundle.claims.every((claim) => claim.quote.length > 0)).toBe(true);

    db.close();
  });

  it('records confirmed values without a quote as unquoted, not as evidence', async () => {
    const { db, runId } = await projectWithEvidence();
    recordExtraction(db, {
      runId,
      sourceId: 'doi:10.1/a',
      field: 'limitation',
      value: 'Not in the abstract.',
      reviewer: 'ada',
    });

    const bundle = buildEvidenceBundle(db, runId, ['finding', 'limitation']);
    expect(bundle.claims).toHaveLength(1);
    expect(bundle.unquoted).toEqual([
      {
        sourceId: 'doi:10.1/a',
        field: 'limitation',
        value: 'Not in the abstract.',
      },
    ]);

    db.close();
  });
});

describe('template draft and checks', () => {
  it('keeps a clean draft and renders citations and references', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, [
      'finding',
      'sample',
      'method',
    ]);
    const draft = checkDraft(bundle, generateTemplateDraft(bundle));

    expect(draft.sentences.every((item) => item.status === 'kept')).toBe(true);
    expect(draft.sentences.some((item) => item.type === 'coverage')).toBe(true);

    const markdown = renderDraftMarkdown(bundle, draft);
    expect(markdown).toContain('(Lovelace, 2024)');
    expect(markdown).toContain('## References');
    expect(markdown).toContain('We surveyed 120 students');
    expect(markdown).not.toContain('Dropped sentences');

    db.close();
  });

  it('drops an evidence sentence whose quote is not in the source text', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, ['finding']);
    const draft = customDraft(bundle, {
      id: 'sentence-bad',
      text: '{{cite:doi:10.1/a}} A claim.',
      type: 'evidence',
      section: 'Finding',
      citations: ['doi:10.1/a'],
      quotes: [{ sourceId: 'doi:10.1/a', quote: 'Not in the abstract.' }],
      status: 'kept',
      checks: [],
    });

    const checked = checkDraft(bundle, draft).sentences[0]!;
    expect(checked.status).toBe('dropped');
    expect(checked.checks.find((item) => item.check.startsWith('3.'))?.message).toContain(
      'quote not found',
    );

    db.close();
  });

  it('drops an evidence sentence whose number is not in its quote', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, ['sample']);
    const draft = customDraft(bundle, {
      id: 'sentence-number',
      text: '{{cite:doi:10.1/a}} We found 999 students.',
      type: 'evidence',
      section: 'Sample',
      citations: ['doi:10.1/a'],
      quotes: [
        {
          sourceId: 'doi:10.1/a',
          quote: 'We surveyed 120 students in a randomized experiment.',
        },
      ],
      status: 'kept',
      checks: [],
    });

    const checked = checkDraft(bundle, draft).sentences[0]!;
    expect(checked.status).toBe('dropped');
    expect(checked.checks.find((item) => item.check.startsWith('4.'))?.message).toContain(
      '999',
    );

    db.close();
  });

  it('drops a coverage sentence with a wrong count and a one-source synthesis', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, ['finding']);

    const coverage = customDraft(bundle, {
      id: 'sentence-coverage',
      text: 'The review includes 5 sources.',
      type: 'coverage',
      section: 'Overview',
      citations: [],
      quotes: [],
      coverage: { included: 2 },
      status: 'kept',
      checks: [],
    });
    expect(checkDraft(bundle, coverage).sentences[0]?.status).toBe('dropped');

    const synthesis = customDraft(bundle, {
      id: 'sentence-synthesis',
      text: 'The evidence disagrees. {{cite:doi:10.1/a}}',
      type: 'synthesis',
      section: 'Synthesis',
      citations: ['doi:10.1/a'],
      quotes: [],
      status: 'kept',
      checks: [],
    });
    expect(checkDraft(bundle, synthesis).sentences[0]?.status).toBe('dropped');

    db.close();
  });

  it('stores the structured draft and markdown', async () => {
    const { db, runId } = await projectWithEvidence();
    const bundle = buildEvidenceBundle(db, runId, ['finding']);
    const draft = checkDraft(bundle, generateTemplateDraft(bundle));
    const markdown = renderDraftMarkdown(bundle, draft);

    const row = saveDraft(db, {
      runId,
      mode: draft.mode,
      writer: draft.writer,
      markdown,
      structured: draft,
      basis: draft.basis,
    });
    const stored = getDraft(db, row.id);
    expect(stored?.markdown).toContain('(Lovelace, 2024)');
    expect(JSON.parse(stored!.structured_json).mode).toBe('review');

    db.close();
  });
});
