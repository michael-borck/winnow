import { randomUUID } from 'node:crypto';
import type { AcademicSource, RetrievalPayload, RetrievedCandidate } from '../types.js';
import { fetchJson } from './http.js';
import { sourceIdFor } from '../text/ids.js';

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }>;
  primary_location?: {
    source?: { display_name?: string | null } | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  type?: string | null;
  cited_by_count?: number | null;
  open_access?: { oa_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

export interface ProviderResult {
  candidates: RetrievedCandidate[];
  payload: RetrievalPayload;
}

export async function retrieveOpenAlex(
  topic: string,
  options: { limit: number; since?: number; until?: number; mailto?: string },
): Promise<ProviderResult> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', topic);
  url.searchParams.set('per-page', String(clamp(options.limit, 1, 200)));
  if (options.mailto) url.searchParams.set('mailto', options.mailto);

  const filters: string[] = [];
  if (options.since) filters.push(`from_publication_date:${options.since}-01-01`);
  if (options.until) filters.push(`to_publication_date:${options.until}-12-31`);
  if (filters.length) url.searchParams.set('filter', filters.join(','));

  const { body, text, url: finalUrl } = await fetchJson(url.toString(), 'openalex', {
    mailto: options.mailto,
  });
  const data = body as OpenAlexResponse;
  const payload: RetrievalPayload = {
    id: `payload-${randomUUID()}`,
    provider: 'openalex',
    query: topic,
    url: finalUrl,
    fetchedAt: new Date().toISOString(),
    body: text,
  };

  const candidates: RetrievedCandidate[] = [];
  (data.results ?? []).forEach((work, index) => {
    const source = mapWork(work);
    if (!source) return;
    candidates.push({
      source,
      provider: 'openalex',
      providerRank: index + 1,
      payloadId: payload.id,
    });
  });

  return { candidates, payload };
}

function mapWork(work: OpenAlexWork): AcademicSource | null {
  const title = (work.display_name ?? work.title ?? '').trim();
  if (!title) return null;

  const doi = work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, '') : undefined;
  const authors = (work.authorships ?? [])
    .map((authorship) => authorship.author?.display_name?.trim() ?? '')
    .filter(Boolean);
  const year = work.publication_year ?? null;
  const url =
    work.primary_location?.landing_page_url ??
    (doi ? `https://doi.org/${doi}` : undefined);

  return {
    id: sourceIdFor({ doi, title, year, authors }),
    title,
    authors,
    year,
    venue: work.primary_location?.source?.display_name ?? undefined,
    type: work.type ?? undefined,
    doi,
    url: url ?? undefined,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    citationCount: work.cited_by_count ?? undefined,
    citationProvider: work.cited_by_count != null ? 'openalex' : undefined,
    citationCollectedAt: work.cited_by_count != null ? new Date().toISOString() : undefined,
    openAccessUrl: work.open_access?.oa_url ?? work.primary_location?.pdf_url ?? undefined,
    sourceProvider: 'openalex',
  };
}

export function abstractFromInvertedIndex(
  index: Record<string, number[]> | null | undefined,
): string | undefined {
  if (!index) return undefined;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  if (!words.length) return undefined;
  return words
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
