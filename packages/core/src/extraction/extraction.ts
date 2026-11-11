import type { DatabaseSync } from 'node:sqlite';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type {
  AcademicSource,
  Citability,
  ScreeningDecision,
  ScreeningRelevance,
  VerificationRecord,
} from '../types.js';
import {
  getLatestExtractions,
  getLatestExtractionSuggestions,
  getRun,
  recordExtractionValue,
  type ExtractionRow,
  type ExtractionSuggestionRow,
} from '../project/db.js';
import { loadScreeningState } from '../screening/screening.js';
import { normaliseDoi } from '../text/normalise.js';

export const DEFAULT_FIELDS = [
  'population',
  'method',
  'sample',
  'finding',
  'limitation',
  'quote',
];

export interface ExtractionSuggestion {
  field: string;
  value: string;
  quote?: string;
  location?: string;
  confidence?: number;
  method: string;
  model?: string;
}

export interface ExtractionSuggestionDraft {
  field: string;
  value: string;
  quote?: string;
  location?: string;
  confidence: number;
  method: 'heuristic';
}

export interface EvidenceRow {
  source: AcademicSource;
  verification: VerificationRecord;
  citability: Citability;
  decision: ScreeningDecision;
  relevance?: ScreeningRelevance;
  rank: number;
  values: Record<string, string>;
  quotes: Record<string, string>;
  locations: Record<string, string>;
  reviewers: Record<string, string>;
  confirmedAt: Record<string, string>;
  suggestions: Record<string, ExtractionSuggestion>;
}

export interface ExtractionCounts {
  included: number;
  extracted: number;
  complete: number;
  missing: number;
}

export interface ExtractionSummary {
  runId: string;
  query: string;
  fields: string[];
  rows: EvidenceRow[];
  counts: ExtractionCounts;
}

export interface ExtractionValueInput {
  sourceId?: string;
  doi?: string;
  field: string;
  value: string;
  quote?: string;
  location?: string;
  reviewer?: string;
}

export interface ExtractionImportResult {
  imported: number;
  skipped: Array<{ key: string; reason: string }>;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export function loadExtractionState(
  db: DatabaseSync,
  runId: string,
  fields: string[] = DEFAULT_FIELDS,
): ExtractionSummary {
  const run = getRun(db, runId);
  if (!run) throw new ExtractionError(`Run not found: ${runId}`);

  const screening = loadScreeningState(db, runId);
  const included = screening.sources.filter(
    (source) => source.decision === 'include',
  );
  const extractions = getLatestExtractions(db, runId);
  const suggestions = getLatestExtractionSuggestions(db, runId);

  const rows: EvidenceRow[] = included.map((item) => {
    const values: Record<string, string> = {};
    const quotes: Record<string, string> = {};
    const locations: Record<string, string> = {};
    const reviewers: Record<string, string> = {};
    const confirmedAt: Record<string, string> = {};
    const suggestionValues: Record<string, ExtractionSuggestion> = {};

    for (const field of fields) {
      const key = fieldKey(item.source.id, field);
      const confirmed = extractions.get(key);
      const suggested = suggestions.get(key);

      if (confirmed?.value) {
        values[field] = confirmed.value;
        if (confirmed.quote) quotes[field] = confirmed.quote;
        if (confirmed.location) locations[field] = confirmed.location;
        reviewers[field] = confirmed.reviewer;
        confirmedAt[field] = confirmed.confirmed_at;
      }
      if (suggested) {
        suggestionValues[field] = {
          field,
          value: suggested.value,
          ...(suggested.quote ? { quote: suggested.quote } : {}),
          ...(suggested.location ? { location: suggested.location } : {}),
          ...(suggested.confidence != null
            ? { confidence: suggested.confidence }
            : {}),
          method: suggested.method,
          ...(suggested.model ? { model: suggested.model } : {}),
        };
      }
    }

    return {
      source: item.source,
      verification: item.verification,
      citability: item.citability,
      decision: item.decision!,
      ...(item.relevance ? { relevance: item.relevance } : {}),
      rank: item.rank,
      values,
      quotes,
      locations,
      reviewers,
      confirmedAt,
      suggestions: suggestionValues,
    };
  });

  const counts = countExtraction(rows, fields);

  return {
    runId,
    query: run.query,
    fields,
    rows,
    counts,
  };
}

export function countExtraction(
  rows: EvidenceRow[],
  fields: string[],
): ExtractionCounts {
  let extracted = 0;
  let complete = 0;

  for (const row of rows) {
    const filled = fields.filter((field) => Boolean(row.values[field])).length;
    if (filled > 0) extracted += 1;
    if (filled === fields.length) complete += 1;
  }

  return {
    included: rows.length,
    extracted,
    complete,
    missing: rows.length - complete,
  };
}

export function suggestExtraction(
  source: AcademicSource,
  fields: string[] = DEFAULT_FIELDS,
): ExtractionSuggestionDraft[] {
  const abstract = source.abstract?.trim();
  if (!abstract) return [];

  const sentences = splitSentences(abstract);
  const finding = firstMatch(
    sentences,
    /(we (find|show|observe|demonstrate|conclude)|results? (show|suggest|indicate)|findings? (show|suggest)|this (study|paper) (finds|shows))/i,
  );
  const limitation = firstMatch(
    sentences,
    /(limitation|future (work|research)|small sample|caveat|did not|not generalis)/i,
  );
  const method = firstMatch(
    sentences,
    /(survey|interview|experiment|randomi[sz]ed|meta-analysis|case study|simulation|questionnaire|dataset|we analy[sz]ed|regression|ethnograph)/i,
  );
  const sample = abstract.match(
    /\b(?:n\s*=\s*\d+|\d+\s+(?:participants|students|papers|articles|studies|responses|developers|projects))\b/i,
  )?.[0];
  const population = abstract.match(
    /\b(?:students|teachers|adults|children|patients|organizations|firms|developers|practitioners|researchers)\b/i,
  )?.[0];

  const drafts: ExtractionSuggestionDraft[] = [];
  const add = (
    field: string,
    value: string | undefined,
    confidence: number,
    quote?: string,
  ) => {
    if (!fields.includes(field) || !value) return;
    drafts.push({
      field,
      value: trimValue(value),
      ...(quote ? { quote } : {}),
      location: 'abstract',
      confidence,
      method: 'heuristic',
    });
  };

  add(
    'population',
    population,
    0.3,
    population ? sentenceContaining(sentences, population) : undefined,
  );
  add('method', method, 0.3, method);
  add(
    'sample',
    sample,
    0.3,
    sample ? sentenceContaining(sentences, sample) : undefined,
  );
  add('finding', finding, 0.4, finding);
  add('limitation', limitation, 0.35, limitation);
  add('quote', finding ?? sentences[0], 0.4, finding ?? sentences[0]);

  return drafts;
}

export function recordExtraction(
  db: DatabaseSync,
  input: {
    runId?: string | null;
    sourceId: string;
    field: string;
    value: string;
    quote?: string;
    location?: string;
    reviewer: string;
  },
): ExtractionRow {
  return recordExtractionValue(db, input);
}

export function importExtractionValues(
  db: DatabaseSync,
  runId: string,
  values: ExtractionValueInput[],
  defaultReviewer: string,
): ExtractionImportResult {
  const run = getRun(db, runId);
  if (!run) throw new ExtractionError(`Run not found: ${runId}`);

  const screening = loadScreeningState(db, runId);
  const included = screening.sources.filter(
    (source) => source.decision === 'include',
  );
  const byId = new Map(included.map((item) => [item.source.id, item.source.id]));
  const byDoi = new Map(
    included
      .filter((item) => item.source.doi)
      .map((item) => [normaliseDoi(item.source.doi!), item.source.id]),
  );

  const skipped: Array<{ key: string; reason: string }> = [];
  let imported = 0;

  for (const value of values) {
    const key = value.sourceId ?? value.doi ?? '(missing)';
    const sourceId = value.sourceId
      ? byId.get(value.sourceId)
      : value.doi
        ? byDoi.get(normaliseDoi(value.doi))
        : undefined;

    if (!sourceId) {
      skipped.push({
        key,
        reason: 'source is not a human-confirmed include in this run',
      });
      continue;
    }
    if (!value.field?.trim() || !value.value?.trim()) {
      skipped.push({ key, reason: 'field and value are required' });
      continue;
    }

    recordExtractionValue(db, {
      runId,
      sourceId,
      field: value.field.trim(),
      value: value.value,
      quote: value.quote,
      location: value.location,
      reviewer: value.reviewer?.trim() || defaultReviewer,
    });
    imported += 1;
  }

  return { imported, skipped };
}

export function parseExtractionValues(
  text: string,
  format: 'csv' | 'json',
): ExtractionValueInput[] {
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
      throw new ExtractionError(
        `Invalid extraction CSV: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return rows
      .map((row, index) => valueFromRow(row, index))
      .filter((item): item is ExtractionValueInput => item !== null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ExtractionError(
      `Invalid extraction JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { values?: unknown }).values)
      ? (parsed as { values: unknown[] }).values
      : null;

  if (!rows) {
    throw new ExtractionError(
      'Extraction JSON must be an array or { values: [...] }',
    );
  }

  return rows
    .map((row, index) => {
      if (typeof row !== 'object' || row === null) {
        throw new ExtractionError(`Value ${index + 1} must be an object`);
      }
      return valueFromRow(row as Record<string, unknown>, index);
    })
    .filter((item): item is ExtractionValueInput => item !== null);
}

export function detectExtractionFormat(
  filename: string,
  text: string,
): 'csv' | 'json' {
  if (filename.toLowerCase().endsWith('.json')) return 'json';
  if (filename.toLowerCase().endsWith('.csv')) return 'csv';
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'csv';
}

export function formatEvidenceTable(summary: ExtractionSummary): string {
  const { counts } = summary;
  const lines = [
    `Run ${summary.runId}: ${summary.query}`,
    `Evidence: ${counts.included} included, ${counts.extracted} with extracted values, ` +
      `${counts.complete} complete, ${counts.missing} missing fields`,
  ];

  if (!summary.rows.length) {
    lines.push(
      'No human-confirmed includes. Run `winnow screen` and include sources first.',
    );
    return `${lines.join('\n')}\n`;
  }

  for (const row of summary.rows) {
    lines.push('');
    lines.push(
      `[${row.rank}] ${row.source.title} (${row.source.year ?? 'n.d.'})` +
        `${row.source.doi ? ` — doi:${row.source.doi}` : ''}`,
    );
    for (const field of summary.fields) {
      const value = row.values[field];
      const suggested = row.suggestions[field];
      if (value) {
        lines.push(`  ${field}: ${trimValue(value, 320)}`);
      } else if (suggested) {
        lines.push(
          `  ${field}: [suggested] ${trimValue(suggested.value, 280)}` +
            `${suggested.confidence != null ? ` (${suggested.confidence.toFixed(2)})` : ''}`,
        );
      } else {
        lines.push(`  ${field}: —`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatEvidenceJson(summary: ExtractionSummary): string {
  return `${JSON.stringify(
    {
      runId: summary.runId,
      query: summary.query,
      fields: summary.fields,
      counts: summary.counts,
      rows: summary.rows.map((row) => ({
        ...row.source,
        verification: row.verification,
        citability: row.citability,
        decision: row.decision,
        relevance: row.relevance ?? null,
        rank: row.rank,
        values: row.values,
        quotes: row.quotes,
        locations: row.locations,
        reviewers: row.reviewers,
        confirmedAt: row.confirmedAt,
        suggestions: row.suggestions,
      })),
    },
    null,
    2,
  )}\n`;
}

export function formatEvidenceCsv(summary: ExtractionSummary): string {
  const records: Array<Record<string, unknown>> = [];

  for (const row of summary.rows) {
    for (const field of summary.fields) {
      const confirmed = row.values[field];
      const quote = row.quotes[field];
      const suggested = row.suggestions[field];
      records.push({
        source_id: row.source.id,
        doi: row.source.doi ?? '',
        title: row.source.title,
        year: row.source.year ?? '',
        field,
        value: confirmed ?? '',
        quote: quote ?? '',
        location: row.locations[field] ?? '',
        reviewer: row.reviewers[field] ?? '',
        confirmed_at: row.confirmedAt[field] ?? '',
        suggested_value: suggested?.value ?? '',
        suggested_quote: suggested?.quote ?? '',
        suggested_confidence: suggested?.confidence ?? '',
        suggested_method: suggested?.method ?? '',
      });
    }
  }

  return stringifyCsv(records, { header: true });
}

function valueFromRow(
  row: Record<string, unknown>,
  index: number,
): ExtractionValueInput | null {
  const sourceId = firstString(row.source_id, row.sourceId, row.id);
  const doi = firstString(row.doi, row.DOI);
  const field = firstString(row.field);
  const value = firstString(row.value);
  if (!field || !value) return null;
  if (!sourceId && !doi) {
    throw new ExtractionError(
      `Value ${index + 1}: expected source_id or doi`,
    );
  }

  const result: ExtractionValueInput = { field, value };
  if (sourceId) result.sourceId = sourceId;
  if (doi) result.doi = doi;
  const quote = firstString(row.quote);
  const location = firstString(row.location);
  const reviewer = firstString(row.reviewer);
  if (quote) result.quote = quote;
  if (location) result.location = location;
  if (reviewer) result.reviewer = reviewer;
  return result;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function firstMatch(sentences: string[], pattern: RegExp): string | undefined {
  return sentences.find((sentence) => pattern.test(sentence));
}

function sentenceContaining(
  sentences: string[],
  value: string,
): string | undefined {
  return sentences.find((sentence) =>
    sentence.toLowerCase().includes(value.toLowerCase()),
  );
}

function trimValue(value: string, length = 240): string {
  const clean = value.trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1)}…`;
}

function fieldKey(sourceId: string, field: string): string {
  return `${sourceId}\u0000${field}`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}
