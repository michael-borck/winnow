import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, initSession } from '../src/api';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ token: 'token-1' })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web api client', () => {
  it('fetches a session token', async () => {
    await initSession();

    expect(fetch).toHaveBeenCalledWith('/api/session');
  });

  it('sends the session token on GET requests', async () => {
    await initSession();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const result = await apiGet<{ ok: boolean }>('/api/state');

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(
      (init?.headers as Record<string, string>)['x-winnow-token'],
    ).toBe('token-1');
  });

  it('sends the token and JSON body on POST requests', async () => {
    await initSession();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const result = await apiPost<{ ok: boolean }>('/api/screen', {
      decision: 'include',
    });

    expect(result.ok).toBe(true);
    const [requestPath, init] = fetchMock.mock.calls.at(-1)!;
    expect(requestPath).toBe('/api/screen');
    expect(init?.method).toBe('POST');
    expect(
      (init?.headers as Record<string, string>)['x-winnow-token'],
    ).toBe('token-1');
    expect(init?.body).toBe(JSON.stringify({ decision: 'include' }));
  });

  it('throws the server error message', async () => {
    await initSession();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: 'bad request' }, 400),
    );

    await expect(apiGet('/api/state')).rejects.toThrow('bad request');
  });
});