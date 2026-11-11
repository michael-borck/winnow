import type { DatabaseSync } from 'node:sqlite';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type {
  AcademicSource,
  Citability,
  ScreeningDecision,
  ScreeningRelevance,
  ScreeningStance,
} from '../types.js';
import {
  getCurrentStances,
  getLatestStanceSuggestions,
  getRun,
  loadRunSources,
  recordStance,
  recordStanceSuggestion,
  type StanceRow,
} from '../project/db.js';
import { loadScreeningState } from '../screening/screening.js';
import { stableHash } from '../text/ids.js';
import { normaliseDoi } from '../text/normalise.js';

export interface StanceSuggestion {
  label: ScreeningStance;
  confidence?: number;
  rationale?: string;
  quote?: string;
  method: string;
  model?: string;
  createdAt: string;
}

export interface StanceSuggestionDraft {
  suggestedLabel: ScreeningStance;
  confidence: number;
  rationale: string;
  quote?: string;
  method: 'heuristic';
}

export interface StanceState {
  source: AcademicSource;
  citability: Citability;
  rank: number;
  decision?: ScreeningDecision;
  relevance?: ScreeningRelevance;
  stance?: ScreeningStance;
  quote?: string;
  rationale?: string;
  reviewer?: string;
  confirmedAt?: string;
  suggestion?: StanceSuggestion;
}

export interface StanceCounts {
  supports: number;
  opposes: number;
  mixed: number;
  unclear: number;
  unlabelled: number;
}

export interface StanceSummary {
  runId: string;
  query: string;
  thesis: string;
  sources: StanceState[];
  counts: StanceCounts;
}

export interface StanceInput {
  sourceId?: string;
  doi?: string;
  label: ScreeningStance;
  quote?: string;
  rationale?: string;
  reviewer?: string;
}

export interface StanceImportResult {
  imported: number;
  skipped: Array<{ key: string; reason: string }>;
}

export class StanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StanceError';
  }
}

const STRONG_CRITICAL_TERMS = [
  'no evidence',
  'fails to',
  'failed to',
  'replication failure',
  'ineffective',
  'not improve',
  'no improvement',
];

const CRITICAL_TERMS = [
  'limitation',
  'critique',
  'criticism',
  'fails to',
  'failed to',
  'no evidence',
  'contrary',
  'challenge',
  'concern',
  'replication failure',
  'ineffective',
  'not improve',
  'no improvement',
  'does not',
  'did not',
  'controvers',
  'oppos',
  'skeptic',
];

const SUPPORTING_TERMS = [
  'improve',
  'effective',
  'support',
  'benefit',
  'positive',
  'outperform',
  'success',
  'enhance',
  'increase',
  'reduce',
  'facilitat',
  'evidence that',
  'demonstrate',
];

export function normaliseThesis(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function thesisHash(text: string): string {
  return stableHash(normaliseThesis(text).toLowerCase());
}

export function loadStanceState(
  db: DatabaseSync,
  runId: string,
  thesis: string,
  options: { all?: boolean } = {},
): StanceSummary {
  const run = getRun(db, runId);
  if (!run) throw new StanceError(`Run not found: ${runId}`);
  const targetHash = thesisHash(thesis);
  const current = getCurrentStances(db, targetHash);
  const suggestions = getLatestStanceSuggestions(db, runId, targetHash);
  const screening = loadScreeningState(db, runId, { all: options.all });

  const sources: StanceState[] = screening.sources.map((item) => {
    const stance = current.get(item.source.id);
    const suggestion = suggestions.get(item.source.id);
    const state: StanceState = {
      source: item.source,
      citability: item.citability,
      rank: item.rank,
      ...(item.decision ? { decision: item.decision } : {}),
      ...(item.relevance ? { relevance: item.relevance } : {}),
    };
    if (stance) {
      state.stance = stance.label;
      if (stance.quote) state.quote = stance.quote;
      if (stance.rationale) state.rationale = stance.rationale;
      state.reviewer = stance.reviewer;
      state.confirmedAt = stance.confirmed_at;
    }
    if (suggestion) {
      state.suggestion = {
        label: suggestion.suggested_label,
        ...(suggestion.confidence != null
          ? { confidence: suggestion.confidence }
          : {}),
        ...(suggestion.rationale ? { rationale: suggestion.rationale } : {}),
        ...(suggestion.quote ? { quote: suggestion.quote } : {}),
        method: suggestion.method,
        ...(suggestion.model ? { model: suggestion.model } : {}),
        createdAt: suggestion.created_at,
      };
    }
    return state;
  });

  return {
    runId,
    query: run.query,
    thesis: normaliseThesis(thesis),
    sources,
    counts: countStances(sources),
  };
}

export function countStances(sources: StanceState[]): StanceCounts {
  const counts: StanceCounts = {
    supports: 0,
    opposes: 0,
    mixed: 0,
    unclear: 0,
    unlabelled: 0,
  };
  for (const source of sources) {
    switch (source.stance) {
      case 'supports':
        counts.supports += 1;
        break;
      case 'opposes':
        counts.opposes += 1;
        break;
      case 'mixed':
        counts.mixed += 1;
        break;
      case 'unclear':
        counts.unclear += 1;
        break;
      default:
        counts.unlabelled += 1;
    }
  }
  return counts;
}

export function suggestStance(
  source: AcademicSource,
  thesis: string,
): StanceSuggestionDraft {
  void thesis;
  const text = `${source.title} ${source.abstract ?? ''}`.trim();
  const lower = text.toLowerCase();
  const strongCritical = STRONG_CRITICAL_TERMS.find((term) =>
    termAppears(lower, term),
  );
  const critical = CRITICAL_TERMS.find((term) => termAppears(lower, term));
  const supporting = SUPPORTING_TERMS.find((term) => termAppears(lower, term));

  if (strongCritical) {
    return {
      suggestedLabel: 'opposes',
      confidence: 0.45,
      rationale: `strong critical cue: ${strongCritical}`,
      ...(sentenceFor(text, strongCritical)
        ? { quote: sentenceFor(text, strongCritical) }
        : {}),
      method: 'heuristic',
    };
  }
  if (critical && supporting) {
    return {
      suggestedLabel: 'mixed',
      confidence: 0.35,
      rationale: `both critical (${critical}) and supporting (${supporting}) cues`,
      ...(sentenceFor(text, critical) ? { quote: sentenceFor(text, critical) } : {}),
      method: 'heuristic',
    };
  }
  if (critical) {
    return {
      suggestedLabel: 'opposes',
      confidence: 0.4,
      rationale: `critical cue: ${critical}`,
      ...(sentenceFor(text, critical) ? { quote: sentenceFor(text, critical) } : {}),
      method: 'heuristic',
    };
  }
  if (supporting) {
    return {
      suggestedLabel: 'supports',
      confidence: 0.4,
      rationale: `supporting cue: ${supporting}`,
      ...(sentenceFor(text, supporting) ? { quote: sentenceFor(text, supporting) } : {}),
      method: 'heuristic',
    };
  }
  return {
    suggestedLabel: 'unclear',
    confidence: 0.2,
    rationale: 'no directional cue in the title or abstract',
    ...(firstSentence(text) ? { quote: firstSentence(text) } : {}),
    method: 'heuristic',
  };
}

export function recordStanceDecision(
  db: DatabaseSync,
  input: {
    runId?: string | null;
    sourceId: string;
    thesis: string;
    label: ScreeningStance;
    quote?: string;
    rationale?: string;
    reviewer: string;
  },
): StanceRow {
  return recordStance(db, {
    ...input,
    target: normaliseThesis(input.thesis),
    targetHash: thesisHash(input.thesis),
  });
}

export function recordStanceSuggestionFor(
  db: DatabaseSync,
  input: {
    runId?: string | null;
    sourceId: string;
    thesis: string;
    draft: StanceSuggestionDraft;
  },
): void {
  recordStanceSuggestion(db, {
    runId: input.runId,
    sourceId: input.sourceId,
    target: normaliseThesis(input.thesis),
    targetHash: thesisHash(input.thesis),
    ...input.draft,
  });
}

export function importStances(
  db: DatabaseSync,
  runId: string,
  thesis: string,
  inputs: StanceInput[],
  defaultReviewer: string,
): StanceImportResult {
  if (!getRun(db, runId)) throw new StanceError(`Run not found: ${runId}`);
  const runSources = loadRunSources(db, runId);
  const byId = new Map(runSources.map((item) => [item.source.id, item.source.id]));
  const byDoi = new Map(
    runSources
      .filter((item) => item.source.doi)
      .map((item) => [normaliseDoi(item.source.doi!), item.source.id]),
  );

  const skipped: Array<{ key: string; reason: string }> = [];
  let imported = 0;

  for (const input of inputs) {
    const key = input.sourceId ?? input.doi ?? '(missing)';
    const sourceId = input.sourceId
      ? byId.get(input.sourceId)
      : input.doi
        ? byDoi.get(normaliseDoi(input.doi))
        : undefined;
    if (!sourceId) {
      skipped.push({ key, reason: 'source is not part of this run' });
      continue;
    }

    recordStanceDecision(db, {
      runId,
      sourceId,
      thesis,
      label: input.label,
      quote: input.quote,
      rationale: input.rationale,
      reviewer: input.reviewer?.trim() || defaultReviewer,
    });
    imported += 1;
  }

  return { imported, skipped };
}

export function parseStances(
  text: string,
  format: 'csv' | 'json',
): StanceInput[] {
  if (format === 'csv') {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = parseCsv(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Array<Record<string, unknown>>;
    } catch (error) {
      throw new StanceError(
        `Invalid stance CSV: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return rows
      .map((row, index) => stanceFromRow(row, index))
      .filter((item): item is StanceInput => item !== null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StanceError(
      `Invalid stance JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { stances?: unknown }).stances)
      ? (parsed as { stances: unknown[] }).stances
      : null;

  if (!rows) {
    throw new StanceError('Stance JSON must be an array or { stances: [...] }');
  }

  return rows
    .map((row, index) => {
      if (typeof row !== 'object' || row === null) {
        throw new StanceError(`Stance ${index + 1} must be an object`);
      }
      return stanceFromRow(row as Record<string, unknown>, index);
    })
    .filter((item): item is StanceInput => item !== null);
}

export function detectStanceFormat(
  filename: string,
  text: string,
): 'csv' | 'json' {
  if (filename.toLowerCase().endsWith('.json')) return 'json';
  if (filename.toLowerCase().endsWith('.csv')) return 'csv';
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'csv';
}

export function formatStanceTable(summary: StanceSummary): string {
  const { counts } = summary;
  const lines = [
    `Run ${summary.runId}: ${summary.query}`,
    `Thesis: ${summary.thesis}`,
    `Stance: supports ${counts.supports}, opposes ${counts.opposes}, mixed ${counts.mixed}, ` +
      `unclear ${counts.unclear}, unlabelled ${counts.unlabelled}`,
  ];

  if (!summary.sources.length) {
    lines.push('No sources in this stance set.');
    return `${lines.join('\n')}\n`;
  }

  const rows = summary.sources.map((item) => [
    String(item.rank),
    item.decision ?? 'undecided',
    item.stance ?? 'unlabelled',
    toolLabel(item.suggestion),
    truncate(item.source.title, 58),
  ]);
  const headers = ['#', 'DECISION', 'STANCE', 'TOOL', 'SOURCE'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd();

  lines.push(
    '',
    line(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
  );
  return `${lines.join('\n')}\n`;
}

export function formatStanceJson(summary: StanceSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function formatStanceCsv(summary: StanceSummary): string {
  return stringifyCsv(
    summary.sources.map((item) => ({
      source_id: item.source.id,
      doi: item.source.doi ?? '',
      title: item.source.title,
      year: item.source.year ?? '',
      decision: item.decision ?? '',
      label: item.stance ?? '',
      quote: item.quote ?? '',
      rationale: item.rationale ?? '',
      reviewer: item.reviewer ?? '',
      confirmed_at: item.confirmedAt ?? '',
      suggested_label: item.suggestion?.label ?? '',
      suggested_confidence: item.suggestion?.confidence ?? '',
      suggested_rationale: item.suggestion?.rationale ?? '',
    })),
    { header: true },
  );
}

function stanceFromRow(
  row: Record<string, unknown>,
  index: number,
): StanceInput | null {
  const sourceId = firstString(row.source_id, row.sourceId, row.id);
  const doi = firstString(row.doi, row.DOI);
  const rawLabel = firstString(row.label, row.stance);
  if (!rawLabel) return null;
  const label = normaliseLabel(rawLabel);
  if (!sourceId && !doi) {
    throw new StanceError(`Stance ${index + 1}: expected source_id or doi`);
  }

  const result: StanceInput = { label };
  if (sourceId) result.sourceId = sourceId;
  if (doi) result.doi = doi;
  const quote = firstString(row.quote);
  const rationale = firstString(row.rationale);
  const reviewer = firstString(row.reviewer);
  if (quote) result.quote = quote;
  if (rationale) result.rationale = rationale;
  if (reviewer) result.reviewer = reviewer;
  return result;
}

function normaliseLabel(value: string): ScreeningStance {
  const clean = value.trim().toLowerCase();
  if (
    clean === 'supports' ||
    clean === 'opposes' ||
    clean === 'mixed' ||
    clean === 'unclear'
  ) {
    return clean;
  }
  throw new StanceError(
    `Stance must be supports, opposes, mixed or unclear; got ${JSON.stringify(value)}`,
  );
}

function termAppears(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, 'iu').test(text);
}

function sentenceFor(text: string, term: string): string | undefined {
  return splitSentences(text).find((sentence) =>
    termAppears(sentence.toLowerCase(), term),
  );
}

function firstSentence(text: string): string | undefined {
  return splitSentences(text)[0];
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function toolLabel(suggestion: StanceSuggestion | undefined): string {
  if (!suggestion) return '-';
  return `${suggestion.label}${suggestion.confidence != null ? ` ${suggestion.confidence.toFixed(2)}` : ''}`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}
