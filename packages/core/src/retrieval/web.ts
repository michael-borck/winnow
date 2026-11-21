import { randomUUID } from 'node:crypto';
import type {
  RetrievalPayload,
  RetrievedCandidate,
} from '../types.js';
import { shortHash } from '../text/ids.js';
import { ProviderError, fetchJson } from './http.js';
import { throttle } from './rateLimiter.js';

type ProviderName = 'brave' | 'serper' | 'searxng';

interface WebHit {
  title: string;
  url: string;
  snippet?: string;
  provider: ProviderName;
}

export interface WebProviderResult {
  candidates: RetrievedCandidate[];
  payload: RetrievalPayload;
}

const DEFAULT_ORDER = 'brave,serper,searxng';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;
const MAX_WEB_RESULTS = 20;

const cache = new Map<string, { at: number; hits: WebHit[] }>();

export function clearWebSearchCache(): void {
  cache.clear();
}

function parseOrder(value: string | undefined): ProviderName[] {
  const seen = new Set<string>();
  const names: ProviderName[] = [];
  for (const part of (value ?? DEFAULT_ORDER).split(',')) {
    const name = part.trim().toLowerCase();
    if (name !== 'brave' && name !== 'serper' && name !== 'searxng') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.length ? names : ['brave', 'serper', 'searxng'];
}

function isConfigured(
  name: ProviderName,
  options: {
    braveApiKey?: string;
    serperApiKey?: string;
    searxngUrl?: string;
  },
): boolean {
  if (name === 'brave') return Boolean(options.braveApiKey);
  if (name === 'serper') return Boolean(options.serperApiKey);
  return Boolean(options.searxngUrl);
}

function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
    ]) {
      url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    let value = url.toString();
    if (value.endsWith('/')) value = value.slice(0, -1);
    return value;
  } catch {
    return raw;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function reasonForStatus(status: number) {
  if (status === 429) return 'rate_limited' as const;
  if (status >= 500) return 'server_error' as const;
  return 'unknown' as const;
}

function reasonForFetchError(error: unknown) {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'timeout' as const;
  }
  return 'network' as const;
}

async function searchBrave(
  query: string,
  apiKey: string,
  limit: number,
): Promise<WebHit[]> {
  await throttle('brave');
  const count = Math.min(Math.max(limit, 1), 20);
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    safesearch: 'strict',
  });

  let response: Response;
  try {
    response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new ProviderError(
      'brave',
      reasonForFetchError(error),
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      'brave',
      reasonForStatus(response.status),
      `brave HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  return (data.web?.results ?? [])
    .filter(
      (hit): hit is { title: string; url: string; description?: string } =>
        Boolean(hit.title && hit.url),
    )
    .slice(0, count)
    .map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.description,
      provider: 'brave' as const,
    }));
}

async function searchSerper(
  query: string,
  apiKey: string,
  limit: number,
): Promise<WebHit[]> {
  await throttle('serper');
  const num = Math.min(Math.max(limit, 1), 100);

  let response: Response;
  try {
    response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ q: query, num }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new ProviderError(
      'serper',
      reasonForFetchError(error),
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      'serper',
      reasonForStatus(response.status),
      `serper HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  return (data.organic ?? [])
    .filter(
      (hit): hit is { title: string; link: string; snippet?: string } =>
        Boolean(hit.title && hit.link),
    )
    .slice(0, num)
    .map((hit) => ({
      title: hit.title,
      url: hit.link,
      snippet: hit.snippet,
      provider: 'serper' as const,
    }));
}

async function searchSearxng(
  query: string,
  baseUrl: string,
  limit: number,
): Promise<WebHit[]> {
  const base = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    safesearch: '1',
  });
  const { body } = await fetchJson(
    `${base}/search?${params}`,
    'searxng',
    { timeoutMs: 15_000 },
  );
  const data = body as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? [])
    .filter(
      (hit): hit is { title: string; url: string; content?: string } =>
        Boolean(hit.title && hit.url),
    )
    .slice(0, limit)
    .map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.content,
      provider: 'searxng' as const,
    }));
}

function cacheKey(
  topic: string,
  providers: ProviderName[],
  limit: number,
  options: {
    braveApiKey?: string;
    serperApiKey?: string;
    searxngUrl?: string;
  },
): string {
  return shortHash(
    JSON.stringify({
      topic,
      providers,
      limit,
      keys: [
        options.braveApiKey ? shortHash(options.braveApiKey) : '',
        options.serperApiKey ? shortHash(options.serperApiKey) : '',
        options.searxngUrl ? shortHash(options.searxngUrl) : '',
      ],
    }),
  );
}

/**
 * Optional grey-literature retrieval. Results are ordinary web pages, so they
 * carry `type: website`, no DOI, and stay `not_indexed_expected` during
 * verification. They are useful for discovery and screening; citation still
 * requires attestation or an independent source.
 */
export async function retrieveWeb(
  topic: string,
  options: {
    limit: number;
    braveApiKey?: string;
    serperApiKey?: string;
    searxngUrl?: string;
    searchFallbackEnabled?: boolean;
    searchFallbackOrder?: string;
  },
): Promise<WebProviderResult> {
  const order = parseOrder(options.searchFallbackOrder);
  const configured = order.filter((name) => isConfigured(name, options));
  const providers =
    options.searchFallbackEnabled === false
      ? configured.slice(0, 1)
      : configured;

  if (!providers.length) {
    throw new ProviderError(
      'web',
      'unknown',
      'No web search provider configured (Brave, Serper or SearXNG)',
    );
  }

  const requested = Math.min(Math.max(options.limit, 1), MAX_WEB_RESULTS);
  const key = cacheKey(topic, providers, requested, options);
  const cached = cache.get(key);
  let hits: WebHit[];

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    hits = cached.hits;
  } else {
    hits = [];
    const errors: string[] = [];
    for (const provider of providers) {
      try {
        const found =
          provider === 'brave'
            ? await searchBrave(topic, options.braveApiKey!, requested * 2)
            : provider === 'serper'
              ? await searchSerper(topic, options.serperApiKey!, requested * 2)
              : await searchSearxng(topic, options.searxngUrl!, requested * 2);
        hits.push(...found);
      } catch (error) {
        errors.push(
          `${provider}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (hits.length === 0 && errors.length > 0) {
      throw new ProviderError(
        'web',
        'unknown',
        `Web search failed: ${errors.join('; ')}`,
      );
    }

    if (hits.length > 0) {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), hits });
    }
  }

  const seen = new Set<string>();
  const deduped: WebHit[] = [];
  for (const hit of hits) {
    if (!isHttpUrl(hit.url)) continue;
    const normalised = normaliseUrl(hit.url);
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    deduped.push(hit);
    if (deduped.length >= requested) break;
  }

  const payload: RetrievalPayload = {
    id: `payload-${randomUUID()}`,
    provider: 'web',
    query: topic,
    url: `web://${providers.join(',')}?q=${encodeURIComponent(topic)}`,
    fetchedAt: new Date().toISOString(),
    body: JSON.stringify(deduped),
  };

  const candidates: RetrievedCandidate[] = deduped.map((hit, index) => ({
    source: {
      id: `web:${shortHash(hit.url)}`,
      title: hit.title,
      authors: [],
      year: null,
      type: 'website',
      url: hit.url,
      abstract: hit.snippet,
      sourceProvider: hit.provider,
    },
    provider: 'web',
    providerRank: index + 1,
    payloadId: payload.id,
  }));

  return { candidates, payload };
}
