import type { RankedSource, ReplaySnapshot, SearchResult } from '../types.js';
import { citabilityNote, isCitable } from '../verification/citability.js';
import { firstAuthorSurname } from '../text/ids.js';

export function formatTable(sources: RankedSource[], includeAbstracts = true): string {
  const selected = sources.filter((source) => source.selected);
  if (!selected.length) return 'No sources selected.';

  const rows = selected.map((item) => [
    String(item.rank),
    item.source.year ? String(item.source.year) : '----',
    truncate(firstAuthorSurname(item.source.authors[0]) || 'Unknown', 18),
    truncate(item.source.title, 58),
    truncate(item.source.venue ?? '', 24),
    item.verification.identity,
    item.citability,
    item.source.citationCount != null ? String(item.source.citationCount) : '',
  ]);

  const headers = ['#', 'YEAR', 'AUTHOR', 'TITLE', 'VENUE', 'IDENTITY', 'CITABILITY', 'CITES'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );

  const line = (cells: string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join('  ')
      .trimEnd();

  const output = [line(headers), widths.map((width) => '-'.repeat(width)).join('  ')];

  for (let index = 0; index < rows.length; index += 1) {
    output.push(line(rows[index]!));
    if (includeAbstracts) {
      const source = selected[index]!;
      const details: string[] = [];
      if (source.source.doi) details.push(`doi:${source.source.doi}`);
      details.push(`${source.citability}${source.source.doi ? '' : ' (no DOI)'}`);
      output.push(`     ${details.join('  ')}`);
      if (source.source.abstract) {
        output.push(...wrap(source.source.abstract, 96).map((part) => `     ${part}`));
      }
    }
  }

  return output.join('\n');
}

export function formatJson(snapshot: ReplaySnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function formatSearchJson(result: SearchResult): string {
  return `${JSON.stringify(
    {
      runId: result.runId,
      query: result.query,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      retrieved: result.retrieved,
      unique: result.unique,
      selectedCount: result.selectedCount,
      citableCount: result.citableCount,
      failures: result.failures,
      sources: result.sources.map((item) => ({
        ...item.source,
        verification: item.verification,
        citability: item.citability,
        rrfScore: item.rrfScore,
        rank: item.rank,
        selected: item.selected,
        providers: item.providers,
      })),
    },
    null,
    2,
  )}\n`;
}

export function formatCsv(sources: RankedSource[]): string {
  const header = [
    'rank',
    'selected',
    'year',
    'first_author',
    'title',
    'venue',
    'doi',
    'identity',
    'match_category',
    'integrity',
    'link_status',
    'citability',
    'citation_count',
    'providers',
  ];

  const lines = [header.join(',')];
  for (const item of sources) {
    lines.push(
      [
        item.rank,
        item.selected ? 'true' : 'false',
        item.source.year ?? '',
        item.source.authors[0] ?? '',
        item.source.title,
        item.source.venue ?? '',
        item.source.doi ?? '',
        item.verification.identity,
        item.verification.matchCategory,
        item.verification.integrity.join(';'),
        item.verification.linkStatus,
        item.citability,
        item.source.citationCount ?? '',
        item.providers.map((provider) => `${provider.provider}:${provider.rank}`).join(';'),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

export function formatBibtex(sources: RankedSource[]): string {
  const taken = new Set<string>();
  const entries: string[] = [];

  for (const item of sources.filter((source) => isCitable(source.citability))) {
    const source = item.source;
    if (!source.title || source.authors.length === 0) continue;

    const key = citeKey(source, taken);
    const isPreprint =
      (source.type ?? '').toLowerCase().includes('preprint') ||
      source.sourceProvider === 'arxiv';
    const type = source.venue && !isPreprint ? 'article' : 'misc';
    const lines = [`@${type}{${key},`];
    const field = (name: string, value: string | undefined) => {
      if (value) lines.push(`  ${name.padEnd(9)}= {${value}},`);
    };

    field('author', source.authors.map(escapeBibtex).join(' and '));
    lines.push(`  title    = {{${escapeBibtex(source.title)}}},`);
    if (!isPreprint) field('journal', source.venue ? escapeBibtex(source.venue) : undefined);
    field('year', source.year ? String(source.year) : undefined);
    field('doi', source.doi);
    field('url', source.url);
    field('note', escapeBibtex(citabilityNote(item.citability, item.verification)));
    lines.push('}');
    entries.push(lines.join('\n'));
  }

  if (!entries.length) return '% No citable records.\n';
  return `${entries.join('\n\n')}\n`;
}

export function formatCsl(sources: RankedSource[]): string {
  const records = sources
    .filter((item) => isCitable(item.citability))
    .filter((item) => item.source.title)
    .map((item) => {
      const source = item.source;
      const record: Record<string, unknown> = {
        id: source.id,
        type: cslType(source.type),
        title: source.title,
        author: source.authors.map(parseAuthor),
        note: citabilityNote(item.citability, item.verification),
      };
      if (source.year) record.issued = { 'date-parts': [[source.year]] };
      if (source.venue) record['container-title'] = source.venue;
      if (source.doi) record.DOI = source.doi;
      if (source.url) record.URL = source.url;
      if (source.abstract) record.abstract = source.abstract;
      return record;
    });

  return `${JSON.stringify(records, null, 2)}\n`;
}

export function formatSourceList(sources: RankedSource[]): string {
  return sources
    .map(
      (item) =>
        `${item.rank}. [${item.citability}] ${item.source.title} (${item.source.year ?? 'n.d.'})`,
    )
    .join('\n');
}

function citeKey(
  source: { authors: string[]; year: number | null; title: string },
  taken: Set<string>,
): string {
  const surname =
    firstAuthorSurname(source.authors[0]).toLowerCase().replace(/[^a-z]/g, '') || 'anon';
  const year = source.year ?? 'nd';
  const word =
    source.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((part) => part && !STOPWORDS.has(part) && !/^\d+$/.test(part)) ?? 'work';
  const base = `${surname}${year}${word}`;
  let key = base;
  let suffix = 0;
  while (taken.has(key)) {
    suffix += 1;
    key = `${base}${String.fromCharCode(96 + suffix)}`;
  }
  taken.add(key);
  return key;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'on',
  'of',
  'for',
  'and',
  'or',
  'in',
  'to',
  'with',
  'is',
  'are',
  'at',
  'by',
  'from',
  'as',
  'its',
  'do',
  'does',
  'not',
]);

function escapeBibtex(value: string): string {
  return value.replace(/([\\{}%&$#_])/g, '\\$1');
}

function parseAuthor(value: string): { family: string; given?: string } {
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    const [family, ...given] = trimmed.split(',');
    return {
      family: family!.trim(),
      ...(given.length ? { given: given.join(',').trim() } : {}),
    };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { family: trimmed };
  return {
    family: parts.pop()!,
    given: parts.join(' '),
  };
}

function cslType(type: string | undefined): string {
  const value = (type ?? '').toLowerCase();
  if (value.includes('book') && value.includes('chapter')) return 'chapter';
  if (value.includes('book')) return 'book';
  if (value.includes('thesis') || value.includes('dissertation')) return 'thesis';
  if (value.includes('report')) return 'report';
  if (value.includes('conference') || value.includes('proceedings')) {
    return 'paper-conference';
  }
  if (value.includes('preprint')) return 'article';
  return 'article-journal';
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}

function wrap(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
