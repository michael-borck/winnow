import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  fetchJson,
  type FetchLike,
} from '../src/retrieval/http.js';

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
  it('retries a rate-limited request and then succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1 ? response('', 429) : response('{"ok":true}');
    };

    const result = await fetchJson('https://example.test', 'test', {
      fetchImpl,
      retries: 3,
      retryBaseMs: 1,
    });

    expect(result.body).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('retries a server error and then gives up', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return response('', 500);
    };

    await expect(
      fetchJson('https://example.test', 'test', {
        fetchImpl,
        retries: 2,
        retryBaseMs: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderError);

    expect(calls).toBe(2);
  });

  it('does not retry a client error', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return response('', 404);
    };

    await expect(
      fetchJson('https://example.test', 'test', {
        fetchImpl,
        retries: 3,
        retryBaseMs: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderError);

    expect(calls).toBe(1);
  });

  it('retries a network failure and then succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return response('{"ok":true}');
    };

    const result = await fetchJson('https://example.test', 'test', {
      fetchImpl,
      retries: 2,
      retryBaseMs: 1,
    });

    expect(result.body).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('rejects a response larger than the cap', async () => {
    const fetchImpl: FetchLike = async () =>
      response('x'.repeat(100), 200, { 'content-length': '100' });

    await expect(
      fetchJson('https://example.test', 'test', {
        fetchImpl,
        maxResponseBytes: 10,
      }),
    ).rejects.toThrow('too large');

  });
});