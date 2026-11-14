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
import {
  dropHeldSentence,
  formatQueueJson,
  formatQueueTable,
  heldSentences,
  loadDraftSnapshot,
  restoreHeldSentence,
  QueueError,
} from '../src/queue/queue.js';
import type { RankedSource, VerificationRecord } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-queue-'));
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

function ranked(): RankedSource {
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
    verification: verification(),
    citability: 'citable',
    rrfScore: 1 / 61,
    rank: 1,
    selected: true,
    providers: [{ provider: 'openalex', rank: 1 }],
  };
}

async function heldDraft(): Promise<{
  db: ReturnType<typeof initProject> extends Promise<infer P> ? P['db'] : never;
  draftId: string;
  runId: string;
}> {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  const runId = 'run-queue-1';
  createRun(project.db, { id: runId, query: 'testing', config: {} });
  saveRunSources(project.db, runId, 'testing', [ranked()]);
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

  const bundle = buildEvidenceBundle(project.db, runId, ['finding']);
  const draft = checkDraft(bundle, generateTemplateDraft(bundle));
  const evidence = draft.sentences.find((item) => item.type === 'evidence')!;
  evidence.status = 'held';
  evidence.support = {
    label: 'unsupported',
    confidence: 0.8,
    rationale: 'The quote does not support the claim.',
    model: 'mock',
    method: 'model',
  };
  draft.citationStyle = 'apa';
  const markdown = renderDraftMarkdown(bundle, draft, 'apa');
  const row = saveDraft(project.db, {
    runId,
    mode: draft.mode,
    writer: draft.writer,
    markdown,
    structured: draft,
    bundle,
    basis: draft.basis,
  });

  return { db: project.db, draftId: row.id, runId };
}

describe('review queue', () => {
  it('lists held sentences and restores them as a new draft revision', async () => {
    const { db, draftId } = await heldDraft();
    const row = getDraft(db, draftId)!;
    const { draft, bundle } = loadDraftSnapshot(row);
    const held = heldSentences(draft);
    expect(held).toHaveLength(1);

    const table = formatQueueTable(row, draft, held);
    expect(table).toContain('Held sentences: 1');
    expect(table).toContain('unsupported');

    const result = restoreHeldSentence(db, {
      draftId,
      sentenceId: held[0]!.id,
      reviewer: 'ada',
      rationale: 'The quote is weaker but still relevant.',
    });
    expect(result.draft.id).not.toBe(draftId);
    expect(result.draft.parent_id).toBe(draftId);
    expect(result.sentence.status).toBe('kept_marked');
    expect(result.sentence.override?.action).toBe('restored');

    const restored = getDraft(db, result.draft.id)!;
    expect(restored.markdown).toContain('[restored by ada]');
    expect(restored.markdown).toContain('(Lovelace, 2024)');
    expect(JSON.parse(restored.structured_json).sentences.some(
      (item: { override?: { action: string } }) => item.override?.action === 'restored',
    )).toBe(true);

    const json = JSON.parse(
      formatQueueJson(restored, JSON.parse(restored.structured_json), []),
    ) as { draftId: string };
    expect(json.draftId).toBe(result.draft.id);

    db.close();
  });

  it('records a dropped override without silently deleting the sentence', async () => {
    const { db, draftId } = await heldDraft();
    const row = getDraft(db, draftId)!;
    const { draft } = loadDraftSnapshot(row);
    const held = heldSentences(draft)[0]!;

    const result = dropHeldSentence(db, {
      draftId,
      sentenceId: held.id,
      reviewer: 'ada',
      rationale: 'Accept the hold.',
    });

    expect(result.draft.parent_id).toBe(draftId);
    expect(result.sentence.status).toBe('held');
    expect(result.sentence.override?.action).toBe('dropped');
    expect(result.draft.markdown).toContain('dropped by reviewer');
    expect(result.draft.markdown).toContain('Accept the hold.');

    db.close();
  });

  it('refuses a draft without a bundle snapshot', async () => {
    const { db, runId } = await heldDraft();
    const row = saveDraft(db, {
      runId,
      mode: 'review',
      writer: 'template',
      markdown: '# Empty',
      structured: { sentences: [] },
      basis: { included: 0, withEvidence: 0, claims: 0 },
    });
    expect(() => loadDraftSnapshot(row)).toThrow(QueueError);

    db.close();
  });
});
