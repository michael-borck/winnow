import type { LookupFailureReason } from '../types.js';

export class ProviderError extends Error {
  readonly provider: string;
  readonly reason: LookupFailureReason;

  constructor(provider: string, reason: LookupFailureReason, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.reason = reason;
  }
}

export interface JsonResponse {
  url: string;
  body: unknown;
  text: string;
}

export async function fetchJson(
  url: string,
  provider: string,
  options: { mailto?: string; timeoutMs?: number; apiKey?: string } = {},
): Promise<JsonResponse> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `Winnow/0.1${options.mailto ? ` (mailto:${options.mailto})` : ''}`,
        ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const reason: LookupFailureReason =
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
    throw new ProviderError(provider, reason, error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    const reason: LookupFailureReason =
      response.status === 429
        ? 'rate_limited'
        : response.status >= 500
          ? 'server_error'
          : 'unknown';
    throw new ProviderError(provider, reason, `${provider} HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return { url, body: JSON.parse(text), text };
  } catch (error) {
    throw new ProviderError(
      provider,
      'unknown',
      `Invalid JSON from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
