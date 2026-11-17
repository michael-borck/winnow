import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProviderError,
  fetchJson,
  type FetchLike,
} from '../src/retrieval/http.js';
import { setMinRequestInterval } from '../src/retrieval/rateLimiter.js';

beforeEach(() => {
  setMinRequestInterval(0);
});

afterEach(() => {
  setMinRequestInterval(1_000);
});

function response(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchJson', () => {
  it('retries a rate-limited request', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1 ? response('', 429) : response('{"ok":true}');
    };

    const result = await fetchJson('https://example.test', 'crossref', {
      fetchImpl,
      retries: 2,
      retryBaseMs: 1,
    });

    expect(result.body).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('retries a network failure', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return response('{"ok":true}');
    };

    const result = await fetchJson('https://example.test', 'openalex', {
      fetchImpl,
      retries: 2,
      retryBaseMs: 1,
    });

    expect(result.body).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('sends an OpenAlex bearer token', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return response('{}');
    };

    await fetchJson('https://example.test', 'openalex', {
      fetchImpl,
      apiKey: 'oa-key',
    });

    expect(headers.Authorization).toBe('Bearer oa-key');
  });

  it('sends a Semantic Scholar API key header', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return response('{}');
    };

    await fetchJson('https://example.test', 'semantic_scholar', {
      fetchImpl,
      apiKey: 's2-key',
    });

    expect(headers['x-api-key']).toBe('s2-key');
  });

  it('rejects a response larger than the cap', async () => {
    const fetchImpl: FetchLike = async () =>
      response('x'.repeat(100), 200, { 'content-length': '100' });

    await expect(
      fetchJson('https://example.test', 'crossref', {
        fetchImpl,
        maxResponseBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});