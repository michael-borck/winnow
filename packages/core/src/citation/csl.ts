import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';

export type CitationStyle = 'apa' | 'vancouver' | 'harvard';

export interface CslSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  url?: string;
  venue?: string;
  type?: string;
  abstract?: string;
}

export class CitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationError';
  }
}

export function normaliseStyle(value: string): CitationStyle {
  const clean = value.trim().toLowerCase();
  if (clean === 'apa' || clean === 'vancouver' || clean === 'harvard') {
    return clean;
  }
  throw new CitationError(
    `Unknown citation style: ${value}. Use apa, vancouver or harvard.`,
  );
}

export function sourceToCsl(source: CslSource): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: source.id,
    type: cslType(source.type),
    title: source.title,
  };

  if (source.authors.length) {
    item.author = source.authors.map(parseAuthor);
  }
  if (source.year) {
    item.issued = { 'date-parts': [[source.year]] };
  }
  if (source.venue) item['container-title'] = source.venue;
  if (source.doi) item.DOI = source.doi;
  if (source.url) item.URL = source.url;
  if (source.abstract) item.abstract = source.abstract;

  return item;
}

export function formatCitation(
  sources: CslSource[],
  style: CitationStyle,
): string {
  if (!sources.length) return '';
  try {
    const cite = new Cite(sources.map(sourceToCsl));
    return String(
      cite.format('citation', {
        style: templateName(style),
        format: 'text',
        lang: 'en-US',
        entry: sources.map((source) => source.id),
        citationsPre: [],
        citationsPost: [],
      }),
    ).trim();
  } catch {
    return `(${sources.map((source) => source.id).join('; ')})`;
  }
}

export function formatBibliography(
  sources: CslSource[],
  style: CitationStyle,
): string[] {
  if (!sources.length) return [];
  try {
    const cite = new Cite(sources.map(sourceToCsl));
    const text = String(
      cite.format('bibliography', {
        style: templateName(style),
        format: 'text',
        lang: 'en-US',
      }),
    );
    return text
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return sources.map(
      (source) =>
        `${source.authors.join(', ') || 'Unknown'} (${source.year ?? 'n.d.'}). ${source.title}.`,
    );
  }
}

function templateName(style: CitationStyle): string {
  return style === 'harvard' ? 'harvard1' : style;
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
