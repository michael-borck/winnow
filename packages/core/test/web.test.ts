import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWebSearchCache,
  retrieveWeb,
} from '../src/retrieval/web.js';
import { ProviderError } from '../src/retrieval/http.js';
import { setMinRequestInterval } from '../src/retrieval/rateLimiter.js';

beforeEach(() => {
  setMinRequestInterval(0);
  clearWebSearchCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  setMinRequestInterval(1_000);
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('retrieveWeb', () => {
  it('maps SearXNG results to non-DOI web candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          results: [
            {
              title: 'Grey literature guide',
              url: 'https://example.org/guide',
              content: 'A practical guide.',
            },
          ],
        }),
      ),
    );

    const result = await retrieveWeb('teaching', {
      limit: 5,
      searxngUrl: 'http://searxng:8080',
      searchFallbackOrder: 'searxng',
    });

    expect(result.candidates).toHaveLength(1);
    const source = result.candidates[0]!.source;
    expect(source.sourceProvider).toBe('searxng');
    expect(source.type).toBe('website');
    expect(source.id).toMatch(/^web:/);
    expect(source.url).toBe('https://example.org/guide');
    expect(result.payload.provider).toBe('web');
  });

  it('falls through a failed provider to the next one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('api.search.brave.com')) {
          return new Response('', { status: 429 });
        }
        if (url.includes('google.serper.dev')) {
          return json({
            organic: [
              {
                title: 'Serper hit',
                link: 'https://example.org/serper',
                snippet: 'Snippet',
              },
            ],
          });
        }
        throw new Error(`unexpected URL: ${url}`);
      }),
    );

    const result = await retrieveWeb('query', {
      limit: 5,
      braveApiKey: 'brave-key',
      serperApiKey: 'serper-key',
      searchFallbackOrder: 'brave,serper',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.source.sourceProvider).toBe('serper');
  });

  it('deduplicates tracking variants of the same URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          results: [
            {
              title: 'A',
              url: 'https://www.example.org/a/?utm_source=newsletter',
            },
            { title: 'A again', url: 'https://example.org/a' },
            { title: 'B', url: 'https://example.org/b' },
          ],
        }),
      ),
    );

    const result = await retrieveWeb('query', {
      limit: 5,
      searxngUrl: 'http://searxng:8080',
      searchFallbackOrder: 'searxng',
    });

    expect(result.candidates).toHaveLength(2);
  });

  it('caches identical queries', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        results: [{ title: 'Cached', url: 'https://example.org/cached' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await retrieveWeb('cached query', {
      limit: 5,
      searxngUrl: 'http://searxng:8080',
      searchFallbackOrder: 'searxng',
    });
    await retrieveWeb('cached query', {
      limit: 5,
      searxngUrl: 'http://searxng:8080',
      searchFallbackOrder: 'searxng',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when no provider is configured', async () => {
    await expect(retrieveWeb('query', { limit: 5 })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('does not fall through when fallback is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    await expect(
      retrieveWeb('query', {
        limit: 5,
        braveApiKey: 'brave-key',
        serperApiKey: 'serper-key',
        searchFallbackOrder: 'brave,serper',
        searchFallbackEnabled: false,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
