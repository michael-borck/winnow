import type { DatabaseSync } from 'node:sqlite';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type {
  AcademicSource,
  Citability,
  ScreeningDecision,
  ScreeningReasonCode,
  ScreeningRelevance,
  VerificationRecord,
} from '../types.js';
import {
  getCurrentScreening,
  getLatestSuggestions,
  getRun,
  loadRunSources,
  recordScreeningDecision,
  runSourceCounts,
} from '../project/db.js';
import { citability } from '../verification/citability.js';
import { matchesType } from '../retrieval/index.js';
import { normaliseDoi, normaliseTitle } from '../text/normalise.js';
import type { Brief } from '../brief/brief.js';

export interface ScreeningSuggestion {
  decision: ScreeningDecision;
  relevance?: ScreeningRelevance;
  confidence?: number;
  rationale?: string;
  method: string;
  model?: string;
  createdAt: string;
}

export interface ScreeningState {
  source: AcademicSource;
  verification: VerificationRecord;
  citability: Citability;
  rank: number;
  selected: boolean;
  filterFlags: string[];
  decision?: ScreeningDecision;
  relevance?: ScreeningRelevance;
  reasonCode?: ScreeningReasonCode;
  reason?: string;
  tags?: string[];
  reviewer?: string;
  decidedAt?: string;
  suggestion?: ScreeningSuggestion;
}

export interface ScreeningCounts {
  identified: number;
  deduplicated: number;
  screened: number;
  included: number;
  excluded: number;
  maybe: number;
  undecided: number;
  filteredOut: number;
}

export interface ScreeningSummary {
  runId: string;
  query: string;
  sources: ScreeningState[];
  counts: ScreeningCounts;
  reasons: Array<{ reason: string; count: number }>;
}

export interface ScreeningDecisionInput {
  sourceId?: string;
  doi?: string;
  decision: ScreeningDecision;
  relevance?: ScreeningRelevance;
  reasonCode?: ScreeningReasonCode;
  reason?: string;
  tags?: string[];
  reviewer?: string;
}

export interface ScreeningImportResult {
  imported: number;
  skipped: Array<{ key: string; reason: string }>;
}

export interface ScreeningOptions {
  all?: boolean;
  brief?: Brief;
  dropExcluded?: boolean;
}

export class ScreeningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreeningError';
  }
}

export function loadScreeningState(
  db: DatabaseSync,
  runId: string,
  options: ScreeningOptions = {},
): ScreeningSummary {
  const run = getRun(db, runId);
  if (!run) throw new ScreeningError(`Run not found: ${runId}`);

  const current = getCurrentScreening(db);
  const suggestions = getLatestSuggestions(db, runId);
  const stored = loadRunSources(db, runId).filter(
    (item) => options.all === true || item.selected,
  );

  const sources: ScreeningState[] = [];
  let filteredOut = 0;

  for (const item of stored) {
    const filterFlags = filterFlagsFor(item.source, options.brief);
    if (filterFlags.length) filteredOut += 1;
    if (options.dropExcluded === true && filterFlags.length) continue;

    const decision = current.get(item.source.id);
    const suggestion = suggestions.get(item.source.id);
    const state: ScreeningState = {
      source: item.source,
      verification: item.verification,
      citability: citability(item.verification),
      rank: item.rank,
      selected: item.selected,
      filterFlags,
    };

    if (decision) {
      state.decision = decision.decision;
      if (decision.relevance) state.relevance = decision.relevance;
      if (decision.reason_code) state.reasonCode = decision.reason_code;
      if (decision.reason) state.reason = decision.reason;
      if (decision.tags_json) {
        try {
          state.tags = JSON.parse(decision.tags_json) as string[];
        } catch {
          state.tags = [];
        }
      }
      state.reviewer = decision.reviewer;
      state.decidedAt = decision.decided_at;
    }

    if (suggestion) {
      state.suggestion = {
        decision: suggestion.suggested_decision,
        ...(suggestion.suggested_relevance
          ? { relevance: suggestion.suggested_relevance }
          : {}),
        ...(suggestion.confidence != null
          ? { confidence: suggestion.confidence }
          : {}),
        ...(suggestion.rationale ? { rationale: suggestion.rationale } : {}),
        method: suggestion.method,
        ...(suggestion.model ? { model: suggestion.model } : {}),
        createdAt: suggestion.created_at,
      };
    }

    sources.push(state);
  }

  const runCounts = runSourceCounts(db, runId);
  const counts = countScreening(sources, runCounts, filteredOut);

  const reasonCounts = new Map<string, number>();
  for (const source of sources) {
    if (source.decision === 'exclude') {
      const reason = source.reasonCode ?? source.reason ?? 'unspecified';
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    runId,
    query: run.query,
    sources,
    counts,
    reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export function countScreening(
  sources: ScreeningState[],
  runCounts: { identified: number; deduplicated: number },
  filteredOut = 0,
): ScreeningCounts {
  let included = 0;
  let excluded = 0;
  let maybe = 0;
  let undecided = 0;

  for (const source of sources) {
    switch (source.decision) {
      case 'include':
        included += 1;
        break;
      case 'exclude':
        excluded += 1;
        break;
      case 'maybe':
        maybe += 1;
        break;
      default:
        undecided += 1;
    }
  }

  return {
    identified: runCounts.identified,
    deduplicated: runCounts.deduplicated,
    screened: included + excluded + maybe,
    included,
    excluded,
    maybe,
    undecided,
    filteredOut,
  };
}

export function importScreeningDecisions(
  db: DatabaseSync,
  runId: string,
  decisions: ScreeningDecisionInput[],
  defaultReviewer: string,
): ScreeningImportResult {
  if (!getRun(db, runId)) throw new ScreeningError(`Run not found: ${runId}`);

  const stored = loadRunSources(db, runId);
  const byId = new Map(stored.map((item) => [item.source.id, item.source.id]));
  const byDoi = new Map(
    stored
      .filter((item) => item.source.doi)
      .map((item) => [normaliseDoi(item.source.doi!), item.source.id]),
  );

  const skipped: Array<{ key: string; reason: string }> = [];
  let imported = 0;

  for (const decision of decisions) {
    const key = decision.sourceId ?? decision.doi ?? '(missing)';
    const sourceId = decision.sourceId
      ? byId.get(decision.sourceId)
      : decision.doi
        ? byDoi.get(normaliseDoi(decision.doi))
        : undefined;

    if (!sourceId) {
      skipped.push({ key, reason: 'source is not part of this run' });
      continue;
    }

    recordScreeningDecision(db, {
      runId,
      sourceId,
      decision: decision.decision,
      relevance: decision.relevance,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      tags: decision.tags,
      reviewer: decision.reviewer?.trim() || defaultReviewer,
    });
    imported += 1;
  }

  return { imported, skipped };
}

export function parseScreeningDecisions(
  text: string,
  format: 'csv' | 'json',
): ScreeningDecisionInput[] {
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
      throw new ScreeningError(
        `Invalid decisions CSV: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return rows
      .map((row, index) => decisionFromRow(row, index))
      .filter((item): item is ScreeningDecisionInput => item !== null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ScreeningError(
      `Invalid decisions JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { decisions?: unknown }).decisions)
      ? (parsed as { decisions: unknown[] }).decisions
      : null;

  if (!rows) {
    throw new ScreeningError(
      'Decisions JSON must be an array or { decisions: [...] }',
    );
  }

  return rows
    .map((row, index) => {
      if (typeof row !== 'object' || row === null) {
        throw new ScreeningError(`Decision ${index + 1} must be an object`);
      }
      return decisionFromRow(row as Record<string, unknown>, index);
    })
    .filter((item): item is ScreeningDecisionInput => item !== null);
}

export function detectScreeningFormat(
  filename: string,
  text: string,
): 'csv' | 'json' {
  if (filename.toLowerCase().endsWith('.json')) return 'json';
  if (filename.toLowerCase().endsWith('.csv')) return 'csv';
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'csv';
}

export function formatScreeningTable(summary: ScreeningSummary): string {
  const { counts } = summary;
  const lines = [
    `Run ${summary.runId}: ${summary.query}`,
    `PRISMA-inspired: identified ${counts.identified}, deduplicated ${counts.deduplicated}, ` +
      `screened ${counts.screened}, included ${counts.included}, excluded ${counts.excluded}, ` +
      `maybe ${counts.maybe}, undecided ${counts.undecided}, filtered out ${counts.filteredOut}`,
  ];

  if (summary.reasons.length) {
    lines.push('Exclusion reasons:');
    for (const item of summary.reasons) {
      lines.push(`  ${item.count} × ${item.reason}`);
    }
  }

  if (!summary.sources.length) {
    lines.push('No sources in this screening set.');
    return `${lines.join('\n')}\n`;
  }

  const rows = summary.sources.map((item) => [
    String(item.rank),
    item.source.year ? String(item.source.year) : '----',
    item.citability,
    toolLabel(item.suggestion),
    item.decision ?? 'undecided',
    item.relevance ?? '-',
    truncate(item.source.title, 52),
    truncate(item.filterFlags.join(','), 28),
  ]);
  const headers = ['#', 'YEAR', 'CIT', 'TOOL', 'DECISION', 'REL', 'SOURCE', 'FLAGS'];
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

export function formatScreeningJson(summary: ScreeningSummary): string {
  return `${JSON.stringify(
    {
      runId: summary.runId,
      query: summary.query,
      counts: summary.counts,
      reasons: summary.reasons,
      sources: summary.sources.map((item) => ({
        ...item.source,
        verification: item.verification,
        citability: item.citability,
        rank: item.rank,
        selected: item.selected,
        filterFlags: item.filterFlags,
        decision: item.decision ?? null,
        relevance: item.relevance ?? null,
        reasonCode: item.reasonCode ?? null,
        reason: item.reason ?? null,
        tags: item.tags ?? [],
        reviewer: item.reviewer ?? null,
        decidedAt: item.decidedAt ?? null,
        suggestion: item.suggestion ?? null,
      })),
    },
    null,
    2,
  )}\n`;
}

export function formatScreeningCsv(summary: ScreeningSummary): string {
  return stringifyCsv(
    summary.sources.map((item) => ({
      source_id: item.source.id,
      doi: item.source.doi ?? '',
      title: item.source.title,
      year: item.source.year ?? '',
      decision: item.decision ?? '',
      relevance: item.relevance ?? '',
      reason_code: item.reasonCode ?? '',
      reason: item.reason ?? '',
      tags: (item.tags ?? []).join(';'),
      reviewer: item.reviewer ?? '',
      decided_at: item.decidedAt ?? '',
      filter_flags: item.filterFlags.join(';'),
      suggested_decision: item.suggestion?.decision ?? '',
      suggested_relevance: item.suggestion?.relevance ?? '',
      suggestion_confidence: item.suggestion?.confidence ?? '',
      suggestion_rationale: item.suggestion?.rationale ?? '',
    })),
    { header: true },
  );
}

export function filterFlagsFor(
  source: AcademicSource,
  brief?: Brief,
): string[] {
  if (!brief) return [];
  const flags: string[] = [];
  const haystack = `${source.title} ${source.abstract ?? ''}`.toLowerCase();
  const venue = normaliseTitle(source.venue ?? '');

  for (const keyword of brief.filters.excludeKeywords) {
    if (keywordMatches(haystack, keyword)) flags.push(`keyword:${keyword}`);
  }

  for (const excluded of brief.filters.excludeVenues) {
    const clean = normaliseTitle(excluded);
    if (venue && clean && (venue === clean || venue.includes(clean))) {
      flags.push(`venue:${excluded}`);
    }
  }

  const hostname = hostnameFor(source.url);
  for (const domain of brief.filters.excludeDomains) {
    const clean = domain.toLowerCase().replace(/^\./, '');
    if (hostname && (hostname === clean || hostname.endsWith(`.${clean}`))) {
      flags.push(`domain:${domain}`);
    }
  }

  for (const type of brief.filters.excludeTypes) {
    if (matchesType(source.type, type)) flags.push(`type:${type}`);
  }

  return flags;
}

function keywordMatches(haystack: string, keyword: string): boolean {
  const clean = keyword.trim().toLowerCase();
  if (!clean) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
    'u',
  );
  return pattern.test(haystack);
}

function hostnameFor(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function decisionFromRow(
  row: Record<string, unknown>,
  index: number,
): ScreeningDecisionInput | null {
  const sourceId = firstString(row.source_id, row.sourceId, row.id);
  const doi = firstString(row.doi, row.DOI);
  const rawDecision = firstString(row.decision);
  if (!rawDecision) return null;
  const decision = normaliseDecision(rawDecision);
  const reason = firstString(row.reason, row.note);
  const reasonCode = normaliseReasonCode(
    firstString(row.reason_code, row.reasonCode),
  );
  const relevance = normaliseRelevance(
    firstString(row.relevance, row.priority),
  );
  const tags = parseTags(row.tags);
  const reviewer = firstString(row.reviewer);

  if (!sourceId && !doi) {
    throw new ScreeningError(
      `Decision ${index + 1}: expected source_id or doi`,
    );
  }

  const result: ScreeningDecisionInput = { decision };
  if (sourceId) result.sourceId = sourceId;
  if (doi) result.doi = doi;
  if (relevance) result.relevance = relevance;
  if (reasonCode) result.reasonCode = reasonCode;
  if (reason) result.reason = reason;
  if (tags?.length) result.tags = tags;
  if (reviewer) result.reviewer = reviewer;
  return result;
}

function normaliseDecision(value: string): ScreeningDecision {
  const clean = value.trim().toLowerCase();
  if (clean === 'include' || clean === 'exclude' || clean === 'maybe') {
    return clean;
  }
  throw new ScreeningError(
    `Decision must be include, exclude or maybe; got ${JSON.stringify(value)}`,
  );
}

function normaliseRelevance(
  value: string | undefined,
): ScreeningRelevance | undefined {
  if (!value) return undefined;
  const clean = value.trim().toLowerCase();
  if (clean === 'core' || clean === 'supporting' || clean === 'peripheral') {
    return clean;
  }
  throw new ScreeningError(
    `Relevance must be core, supporting or peripheral; got ${JSON.stringify(value)}`,
  );
}

const REASON_CODES = new Set<ScreeningReasonCode>([
  'off_topic',
  'wrong_population',
  'wrong_method',
  'not_empirical',
  'duplicate',
  'not_accessible',
  'out_of_scope_date',
  'out_of_scope_venue',
  'other',
]);

function normaliseReasonCode(
  value: string | undefined,
): ScreeningReasonCode | undefined {
  if (!value) return undefined;
  const clean = value.trim().toLowerCase() as ScreeningReasonCode;
  if (REASON_CODES.has(clean)) return clean;
  throw new ScreeningError(
    `Reason code must be one of: ${[...REASON_CODES].join(', ')}; got ${JSON.stringify(value)}`,
  );
}

function parseTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return tags.length ? tags : undefined;
  }
  if (typeof value === 'string') {
    const tags = value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return tags.length ? tags : undefined;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function toolLabel(suggestion: ScreeningSuggestion | undefined): string {
  if (!suggestion) return '-';
  const confidence =
    suggestion.confidence != null ? ` ${suggestion.confidence.toFixed(2)}` : '';
  return `${suggestion.decision}/${suggestion.relevance ?? '-'}${confidence}`;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}
