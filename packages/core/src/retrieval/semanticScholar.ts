import { randomUUID } from 'node:crypto';
import type {
  AcademicSource,
  RetrievalPayload,
  RetrievedCandidate,
} from '../types.js';
import { sourceIdFor } from '../text/ids.js';
import { fetchJson } from './http.js';

interface SemanticScholarPaper {
  paperId?: string;
  title?: string;
  abstract?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  externalIds?: { DOI?: string; ArXiv?: string };
  url?: string;
  citationCount?: number;
  venue?: string;
}

interface SemanticScholarCitation {
  citingPaper?: SemanticScholarPaper;
  contexts?: string[];
}

interface SemanticScholarResponse {
  data?: SemanticScholarCitation[];
}

export interface CitationChaseOptions {
  limit: number;
  baseUrl?: string;
  apiKey?: string;
  mailto?: string;
}

export interface CitationChaseProviderResult {
  candidates: RetrievedCandidate[];
  payload: RetrievalPayload;
}

export async function fetchCitationCandidates(
  doi: string,
  options: CitationChaseOptions,
): Promise<CitationChaseProviderResult> {
  const baseUrl =
    options.baseUrl ?? 'https://api.semanticscholar.org/graph/v1';
  const url = new URL(
    `${baseUrl.replace(/\/+$/, '')}/paper/DOI:${encodeURIComponent(doi)}/citations`,
  );
  url.searchParams.set(
    'fields',
    'title,abstract,authors,year,externalIds,url,citationCount,venue,contexts',
  );
  url.searchParams.set('limit', String(clamp(options.limit, 1, 100)));
  if (options.mailto) url.searchParams.set('mailto', options.mailto);

  const { body, text, url: finalUrl } = await fetchJson(
    url.toString(),
    'semantic_scholar',
    { apiKey: options.apiKey, timeoutMs: 25_000 },
  );
  const data = body as SemanticScholarResponse;
  const payload: RetrievalPayload = {
    id: `payload-${randomUUID()}`,
    provider: 'semantic_scholar',
    query: `citations of ${doi}`,
    url: finalUrl,
    fetchedAt: new Date().toISOString(),
    body: text,
  };

  const candidates: RetrievedCandidate[] = [];
  (data.data ?? []).forEach((item, index) => {
    const source = mapCitingPaper(item);
    if (!source) return;
    candidates.push({
      source,
      provider: 'semantic_scholar',
      providerRank: index + 1,
      payloadId: payload.id,
    });
  });

  return { candidates, payload };
}

/**
 * Semantic Scholar returns citations in relevance order, but counter-evidence
 * wants the critical citers first. This is a deterministic sample, not a
 * judgement about the citing paper.
 */
export function sampleCitationCandidates(
  candidates: RetrievedCandidate[],
  limit: number,
): RetrievedCandidate[] {
  const scored = candidates.map((candidate) => {
    const contexts = candidate.source.citationContexts ?? [];
    return {
      candidate,
      critical: contexts.filter(hasCriticalContext).length,
      contexts: contexts.length,
    };
  });

  scored.sort((a, b) => {
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.contexts !== a.contexts) return b.contexts - a.contexts;
    const year = (b.candidate.source.year ?? 0) - (a.candidate.source.year ?? 0);
    if (year !== 0) return year;
    const citations =
      (b.candidate.source.citationCount ?? 0) -
      (a.candidate.source.citationCount ?? 0);
    if (citations !== 0) return citations;
    return a.candidate.source.title.localeCompare(b.candidate.source.title);
  });

  return scored
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map((item, index) => ({
      ...item.candidate,
      providerRank: index + 1,
    }));
}

export function hasCriticalContext(context: string): boolean {
  const clean = context.toLowerCase();
  return CRITICAL_CONTEXT_TERMS.some((term) => termAppears(clean, term));
}

const CRITICAL_CONTEXT_TERMS = [
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

function termAppears(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, 'iu').test(text);
}

function mapCitingPaper(
  citation: SemanticScholarCitation,
): AcademicSource | null {
  const paper = citation.citingPaper;
  if (!paper) return null;

  const title = paper.title?.trim();
  if (!title) return null;

  const doi = paper.externalIds?.DOI?.toLowerCase();
  const authors = (paper.authors ?? [])
    .map((author) => author.name?.trim() ?? '')
    .filter(Boolean);
  const year = paper.year ?? null;

  return {
    id: sourceIdFor({ doi, title, year, authors }),
    title,
    authors,
    year,
    venue: paper.venue ?? undefined,
    type: 'article',
    doi,
    url: paper.url ?? (doi ? `https://doi.org/${doi}` : undefined),
    abstract: paper.abstract ?? undefined,
    citationCount: paper.citationCount ?? undefined,
    citationProvider:
      paper.citationCount != null ? 'semantic_scholar' : undefined,
    citationCollectedAt:
      paper.citationCount != null ? new Date().toISOString() : undefined,
    citationContexts: citation.contexts?.filter(Boolean) ?? [],
    sourceProvider: 'semantic_scholar',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
