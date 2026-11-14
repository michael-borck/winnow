import type { DatabaseSync } from 'node:sqlite';
import {
  getDraft,
  saveDraft,
  type DraftRow,
} from '../project/db.js';
import {
  renderDraftMarkdown,
  type DraftSentence,
  type EvidenceBundle,
  type StructuredDraft,
} from '../drafting/drafting.js';
import { registerCslStyle } from '../citation/csl.js';

export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

export interface RestoreResult {
  draft: DraftRow;
  sentence: DraftSentence;
}

export function loadDraftSnapshot(row: DraftRow): {
  draft: StructuredDraft;
  bundle: EvidenceBundle;
} {
  if (!row.bundle_json) {
    throw new QueueError(
      'Draft has no bundle snapshot; re-run `winnow review` to create one',
    );
  }
  return {
    draft: JSON.parse(row.structured_json) as StructuredDraft,
    bundle: JSON.parse(row.bundle_json) as EvidenceBundle,
  };
}

export function heldSentences(draft: StructuredDraft): DraftSentence[] {
  return draft.sentences.filter((sentence) => sentence.status === 'held');
}

export function restoreHeldSentence(
  db: DatabaseSync,
  input: {
    draftId: string;
    sentenceId: string;
    reviewer: string;
    rationale?: string;
  },
): RestoreResult {
  return reviseHeldSentence(db, input, 'restored');
}

export function dropHeldSentence(
  db: DatabaseSync,
  input: {
    draftId: string;
    sentenceId: string;
    reviewer: string;
    rationale?: string;
  },
): RestoreResult {
  return reviseHeldSentence(db, input, 'dropped');
}

export function formatQueueTable(
  row: DraftRow,
  draft: StructuredDraft,
  held: DraftSentence[],
): string {
  const lines = [
    `Draft ${row.id}: ${draft.title}`,
    `Held sentences: ${held.length}`,
  ];

  if (!held.length) {
    lines.push('Nothing held.');
    return `${lines.join('\n')}\n`;
  }

  for (const sentence of held) {
    lines.push('', `- ${sentence.id}: ${sentence.text}`);
    if (sentence.support) {
      lines.push(
        `  support: ${sentence.support.label}` +
          `${sentence.support.rationale ? ` — ${sentence.support.rationale}` : ''}`,
      );
    }
    if (sentence.override) {
      lines.push(
        `  override: ${sentence.override.action} by ${sentence.override.reviewer}` +
          `${sentence.override.rationale ? ` — ${sentence.override.rationale}` : ''}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatQueueJson(
  row: DraftRow,
  draft: StructuredDraft,
  held: DraftSentence[],
): string {
  return `${JSON.stringify(
    {
      draftId: row.id,
      runId: row.run_id,
      title: draft.title,
      held,
    },
    null,
    2,
  )}\n`;
}

function reviseHeldSentence(
  db: DatabaseSync,
  input: {
    draftId: string;
    sentenceId: string;
    reviewer: string;
    rationale?: string;
  },
  action: 'restored' | 'dropped',
): RestoreResult {
  const row = getDraft(db, input.draftId);
  if (!row) throw new QueueError(`Draft not found: ${input.draftId}`);

  const { draft, bundle } = loadDraftSnapshot(row);
  const sentence = draft.sentences.find((item) => item.id === input.sentenceId);
  if (!sentence) {
    throw new QueueError(`Sentence not found: ${input.sentenceId}`);
  }
  if (sentence.status !== 'held') {
    throw new QueueError(
      `Sentence ${input.sentenceId} is ${sentence.status}, not held`,
    );
  }

  const updated: DraftSentence = {
    ...sentence,
    status: action === 'restored' ? 'kept_marked' : 'held',
    override: {
      action,
      reviewer: input.reviewer,
      ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
      at: new Date().toISOString(),
    },
    checks: [
      ...sentence.checks.filter((check) => !check.check.startsWith('6. override')),
      {
        check: '6. override',
        ok: true,
        message: `${action} by ${input.reviewer}`,
      },
    ],
  };

  const updatedDraft: StructuredDraft = {
    ...draft,
    sentences: draft.sentences.map((item) =>
      item.id === updated.id ? updated : item,
    ),
  };
  const style = updatedDraft.citationStyle ?? 'apa';
  if (updatedDraft.citationStyleXml && updatedDraft.citationStyle) {
    registerCslStyle(updatedDraft.citationStyle, updatedDraft.citationStyleXml);
  }
  const markdown = renderDraftMarkdown(bundle, updatedDraft, style);

  const newRow = saveDraft(db, {
    runId: row.run_id,
    parentId: row.id,
    mode: row.mode,
    writer: row.writer,
    model: row.model ?? undefined,
    markdown,
    structured: updatedDraft,
    bundle,
    basis: updatedDraft.basis,
  });

  return { draft: newRow, sentence: updated };
}
