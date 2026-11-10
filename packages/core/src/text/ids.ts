import { createHash } from 'node:crypto';
import { normaliseDoi, normaliseTitle } from './normalise.js';

export function firstAuthorSurname(author: string | undefined): string {
  if (!author) return '';
  const cleaned = author.trim();
  if (!cleaned) return '';
  if (cleaned.includes(',')) return cleaned.split(',')[0]!.trim();
  return cleaned.split(/\s+/).pop() ?? '';
}

export function sourceIdFor(input: {
  doi?: string;
  title: string;
  year: number | null;
  authors: string[];
}): string {
  if (input.doi) return `doi:${normaliseDoi(input.doi)}`;

  const key = [
    normaliseTitle(input.title),
    input.year ?? '',
    firstAuthorSurname(input.authors[0]),
  ].join('|');
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `src:${digest}`;
}

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
