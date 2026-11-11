import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { stableHash } from '../text/ids.js';

export type BriefMode = 'explore' | 'review' | 'argue';

export interface BriefFilters {
  types: string[];
  languages: string[];
  since?: number;
  until?: number;
  openAccess?: boolean;
}

export interface BriefCriteria {
  include: string[];
  exclude: string[];
}

export interface BriefScope {
  dateRange?: { from?: number; to?: number };
  disciplines: string[];
  languages: string[];
}

export interface Brief {
  mode: BriefMode;
  question?: string;
  thesis?: string;
  scope: BriefScope;
  filters: BriefFilters;
  criteria: BriefCriteria;
  counter: boolean;
  context?: string;
  raw: string;
  path?: string;
}

export interface BriefWarning {
  field: string;
  message: string;
}

export interface ParsedBrief {
  brief: Brief;
  warnings: BriefWarning[];
}

export class BriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefError';
  }
}

const TOP_LEVEL_KEYS = new Set([
  'mode',
  'question',
  'thesis',
  'scope',
  'filters',
  'criteria',
  'counter',
]);
const SCOPE_KEYS = new Set(['date_range', 'disciplines', 'languages']);
const FILTER_KEYS = new Set(['types', 'languages', 'since', 'until', 'open_access']);
const CRITERIA_KEYS = new Set(['include', 'exclude']);

export function parseBrief(
  text: string,
  options: { path?: string } = {},
): ParsedBrief {
  const warnings: BriefWarning[] = [];
  const frontmatter = splitFrontmatter(text);
  if (!frontmatter) {
    throw new BriefError(
      'Brief must start with YAML frontmatter between two --- lines',
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter.yaml) ?? {};
  } catch (error) {
    throw new BriefError(
      `Invalid YAML in brief: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const data = asRecord(parsed, 'brief');
  warnUnknown(data, TOP_LEVEL_KEYS, 'brief', warnings);

  const mode = parseMode(data.mode);
  const question = optionalString(data.question, 'question');
  const thesis = optionalString(data.thesis, 'thesis');

  if (!question && !thesis) {
    throw new BriefError('Brief needs a question or a thesis');
  }
  if (mode === 'argue' && !thesis) {
    throw new BriefError('mode: argue requires a thesis');
  }

  const scopeData = optionalRecord(data.scope, 'scope');
  const filtersData = optionalRecord(data.filters, 'filters');
  const criteriaData = optionalRecord(data.criteria, 'criteria');

  warnUnknown(scopeData, SCOPE_KEYS, 'scope', warnings);
  warnUnknown(filtersData, FILTER_KEYS, 'filters', warnings);
  warnUnknown(criteriaData, CRITERIA_KEYS, 'criteria', warnings);

  const dateRange = parseDateRange(scopeData.date_range, warnings);
  const scope: BriefScope = {
    disciplines: stringArray(
      scopeData.disciplines,
      'scope.disciplines',
      warnings,
    ),
    languages: stringArray(scopeData.languages, 'scope.languages', warnings),
  };
  if (dateRange) scope.dateRange = dateRange;

  const filters: BriefFilters = {
    types: stringArray(filtersData.types, 'filters.types', warnings),
    languages: stringArray(filtersData.languages, 'filters.languages', warnings),
  };

  const explicitSince = optionalYear(
    filtersData.since,
    'filters.since',
    warnings,
  );
  const explicitUntil = optionalYear(
    filtersData.until,
    'filters.until',
    warnings,
  );

  if (
    explicitSince != null &&
    dateRange?.from != null &&
    explicitSince !== dateRange.from
  ) {
    warnings.push({
      field: 'filters.since',
      message: `overrides scope.date_range start (${dateRange.from})`,
    });
  }
  if (
    explicitUntil != null &&
    dateRange?.to != null &&
    explicitUntil !== dateRange.to
  ) {
    warnings.push({
      field: 'filters.until',
      message: `overrides scope.date_range end (${dateRange.to})`,
    });
  }

  const since = explicitSince ?? dateRange?.from;
  const until = explicitUntil ?? dateRange?.to;
  if (since != null) filters.since = since;
  if (until != null) filters.until = until;

  if (since != null && until != null && since > until) {
    throw new BriefError('Brief date range starts after it ends');
  }

  const openAccess = optionalBoolean(
    filtersData.open_access,
    'filters.open_access',
    warnings,
  );
  if (openAccess != null) filters.openAccess = openAccess;

  const criteria: BriefCriteria = {
    include: stringArray(criteriaData.include, 'criteria.include', warnings),
    exclude: stringArray(criteriaData.exclude, 'criteria.exclude', warnings),
  };

  const counter = optionalBoolean(data.counter, 'counter', warnings) ?? false;

  const brief: Brief = {
    mode,
    scope,
    filters,
    criteria,
    counter,
    raw: text,
  };
  if (question) brief.question = question;
  if (thesis) brief.thesis = thesis;
  if (frontmatter.body) brief.context = frontmatter.body;
  if (options.path) brief.path = options.path;

  return { brief, warnings };
}

export async function readBrief(filePath: string): Promise<ParsedBrief> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new BriefError(
      `Cannot read brief ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseBrief(text, { path: filePath });
}

export function briefId(brief: Brief): string {
  return `brief-${stableHash(brief.raw).slice(0, 16)}`;
}

export function formatBriefSummary(parsed: ParsedBrief): string {
  const { brief } = parsed;
  const lines = [
    `Brief: ${brief.path ?? '(inline)'}`,
    `Mode: ${brief.mode}`,
  ];

  if (brief.question) lines.push(`Question: ${brief.question}`);
  if (brief.thesis) lines.push(`Thesis: ${brief.thesis}`);

  const filters: string[] = [];
  if (brief.filters.since != null) filters.push(`since ${brief.filters.since}`);
  if (brief.filters.until != null) filters.push(`until ${brief.filters.until}`);
  if (brief.filters.types.length) {
    filters.push(`types ${brief.filters.types.join(', ')}`);
  }
  if (brief.filters.languages.length) {
    filters.push(`languages ${brief.filters.languages.join(', ')}`);
  }
  if (brief.filters.openAccess != null) {
    filters.push(`open access ${brief.filters.openAccess ? 'only' : 'any'}`);
  }
  lines.push(`Filters: ${filters.length ? filters.join('; ') : 'none'}`);

  if (brief.scope.disciplines.length) {
    lines.push(`Disciplines: ${brief.scope.disciplines.join(', ')}`);
  }
  if (brief.scope.languages.length) {
    lines.push(`Scope languages: ${brief.scope.languages.join(', ')}`);
  }

  lines.push(
    `Criteria: ${brief.criteria.include.length} include, ${brief.criteria.exclude.length} exclude`,
  );
  lines.push(`Counter-evidence: ${brief.counter ? 'requested' : 'off'}`);
  if (brief.context) {
    lines.push(`Context: ${brief.context.split(/\s+/).length} words`);
  }

  if (parsed.warnings.length) {
    lines.push('Warnings:');
    for (const warning of parsed.warnings) {
      lines.push(`  - ${warning.field}: ${warning.message}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatBriefJson(brief: Brief): string {
  return `${JSON.stringify(brief, null, 2)}\n`;
}

function splitFrontmatter(
  text: string,
): { yaml: string; body: string } | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (closing === -1) {
    throw new BriefError('Brief frontmatter is not closed with ---');
  }

  return {
    yaml: lines.slice(1, closing).join('\n'),
    body: lines.slice(closing + 1).join('\n').trim(),
  };
}

function parseMode(value: unknown): BriefMode {
  if (value == null) return 'review';
  if (value === 'explore' || value === 'review' || value === 'argue') {
    return value;
  }
  throw new BriefError('mode must be explore, review or argue');
}

function parseDateRange(
  value: unknown,
  warnings: BriefWarning[],
): { from?: number; to?: number } | undefined {
  if (value == null) return undefined;

  if (typeof value === 'string') {
    const clean = value.trim();
    const single = clean.match(/^(\d{4})$/);
    if (single) {
      const year = validateYear(Number(single[1]), 'scope.date_range', warnings);
      return year == null ? undefined : { from: year, to: year };
    }

    const match = clean.match(
      /^(\d{4})?\s*(?:\.\.|–|-|to)\s*(\d{4})?$/i,
    );
    if (!match) {
      warnings.push({
        field: 'scope.date_range',
        message: 'expected YYYY..YYYY',
      });
      return undefined;
    }

    const from = match[1]
      ? validateYear(Number(match[1]), 'scope.date_range', warnings)
      : undefined;
    const to = match[2]
      ? validateYear(Number(match[2]), 'scope.date_range', warnings)
      : undefined;
    if (from == null && to == null) return undefined;
    if (from != null && to != null && from > to) {
      throw new BriefError('scope.date_range starts after it ends');
    }

    const range: { from?: number; to?: number } = {};
    if (from != null) range.from = from;
    if (to != null) range.to = to;
    return range;
  }

  if (Array.isArray(value)) {
    if (value.length !== 2) {
      warnings.push({
        field: 'scope.date_range',
        message: 'expected [from, to]',
      });
      return undefined;
    }
    const from = validateYear(Number(value[0]), 'scope.date_range', warnings);
    const to = validateYear(Number(value[1]), 'scope.date_range', warnings);
    if (from == null || to == null) return undefined;
    if (from > to) {
      throw new BriefError('scope.date_range starts after it ends');
    }
    return { from, to };
  }

  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    const from = optionalYear(data.from, 'scope.date_range.from', warnings);
    const to = optionalYear(data.to, 'scope.date_range.to', warnings);
    if (from == null && to == null) return undefined;
    if (from != null && to != null && from > to) {
      throw new BriefError('scope.date_range starts after it ends');
    }
    const range: { from?: number; to?: number } = {};
    if (from != null) range.from = from;
    if (to != null) range.to = to;
    return range;
  }

  warnings.push({
    field: 'scope.date_range',
    message: 'expected a string, [from, to], or { from, to }',
  });
  return undefined;
}

function validateYear(
  value: number,
  field: string,
  warnings: BriefWarning[],
): number | undefined {
  if (!Number.isInteger(value) || value < 1000 || value > 3000) {
    warnings.push({ field, message: 'expected a four-digit year' });
    return undefined;
  }
  return value;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BriefError(`${field} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  return value == null ? {} : asRecord(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new BriefError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArray(
  value: unknown,
  field: string,
  warnings: BriefWarning[],
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new BriefError(`${field} must be a list`);
  }

  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      warnings.push({
        field,
        message: 'ignored a non-string or empty item',
      });
      continue;
    }
    values.push(item.trim());
  }
  return values;
}

function optionalYear(
  value: unknown,
  field: string,
  warnings: BriefWarning[],
): number | undefined {
  if (value == null) return undefined;
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return validateYear(number, field, warnings);
}

function optionalBoolean(
  value: unknown,
  field: string,
  warnings: BriefWarning[],
): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  warnings.push({ field, message: 'expected true or false' });
  return undefined;
}

function warnUnknown(
  data: Record<string, unknown>,
  allowed: Set<string>,
  prefix: string,
  warnings: BriefWarning[],
): void {
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      warnings.push({
        field: `${prefix}.${key}`,
        message: 'unknown field; ignored',
      });
    }
  }
}
