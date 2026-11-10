import { randomUUID } from 'node:crypto';
import type { AcademicSource, RetrievalPayload, RetrievedCandidate } from '../types.js';
import { fetchJson } from './http.js';
import { sourceIdFor } from '../text/ids.js';
import { normaliseText } from '../text/normalise.js';

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  type?: string;
  'is-referenced-by-count'?: number;
  abstract?: string;
  URL?: string;
  link?: Array<{ URL?: string; 'content-type'?: string }>;
}

interface CrossrefResponse {
  message?: { items?: CrossrefItem[] };
}

export interface ProviderResult {
  candidates: RetrievedCandidate[];
  payload: RetrievalPayload;
}

export async function retrieveCrossref(
  topic: string,
  options: { limit: number; since?: number; until?: number; mailto?: string },
): Promise<ProviderResult> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', topic);
  url.searchParams.set('rows', String(clamp(options.limit, 1, 200)));
  if (options.mailto) url.searchParams.set('mailto', options.mailto);

  const filters: string[] = [];
  if (options.since) filters.push(`from-pub-date:${options.since}-01-01`);
  if (options.until) filters.push(`until-pub-date:${options.until}-12-31`);
  if (filters.length) url.searchParams.set('filter', filters.join(','));

  const { body, text, url: finalUrl } = await fetchJson(url.toString(), 'crossref', {
    mailto: options.mailto,
  });
  const data = body as CrossrefResponse;
  const items = data.message?.items ?? [];
  const payload: RetrievalPayload = {
    id: `payload-${randomUUID()}`,
    provider: 'crossref',
    query: topic,
    url: finalUrl,
    fetchedAt: new Date().toISOString(),
    body: text,
  };

  const candidates: RetrievedCandidate[] = [];
  items.forEach((item, index) => {
    const source = mapItem(item);
    if (!source) return;
    candidates.push({
      source,
      provider: 'crossref',
      providerRank: index + 1,
      payloadId: payload.id,
    });
  });

  return { candidates, payload };
}

function mapItem(item: CrossrefItem): AcademicSource | null {
  const title = (item.title?.[0] ?? '').trim();
  if (!title) return null;

  const doi = item.DOI?.toLowerCase();
  const authors = (item.author ?? [])
    .map((author) => {
      if (author.name) return author.name;
      return [author.given, author.family].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean);
  const year = item.issued?.['date-parts']?.[0]?.[0] ?? null;
  const openAccessUrl = item.link?.find(
    (link) => link['content-type'] === 'application/pdf',
  )?.URL;

  return {
    id: sourceIdFor({ doi, title, year, authors }),
    title,
    authors,
    year,
    venue: item['container-title']?.[0],
    type: item.type,
    doi,
    url: item.URL,
    abstract: item.abstract ? normaliseText(item.abstract) : undefined,
    citationCount: item['is-referenced-by-count'],
    citationProvider:
      item['is-referenced-by-count'] != null ? 'crossref' : undefined,
    citationCollectedAt:
      item['is-referenced-by-count'] != null ? new Date().toISOString() : undefined,
    openAccessUrl,
    sourceProvider: 'crossref',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
