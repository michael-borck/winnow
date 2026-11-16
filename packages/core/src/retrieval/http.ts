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

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchJsonOptions {
  mailto?: string;
  timeoutMs?: number;
  apiKey?: string;
  fetchImpl?: FetchLike;
  retries?: number;
  retryBaseMs?: number;
  maxResponseBytes?: number;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export async function fetchJson(
  url: string,
  provider: string,
  options: FetchJsonOptions = {},
): Promise<JsonResponse> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const maxAttempts = Math.max(1, options.retries ?? DEFAULT_RETRIES);
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `Winnow/0.1${options.mailto ? ` (mailto:${options.mailto})` : ''}`,
          ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= maxAttempts) {
        const reason: LookupFailureReason =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'network';
        throw new ProviderError(
          provider,
          reason,
          error instanceof Error ? error.message : String(error),
        );
      }
      await sleep(backoff(attempt, retryBaseMs));
      continue;
    }

    if (response.ok) {
      const text = await readCappedText(
        response,
        provider,
        maxResponseBytes,
      );
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

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = retryAfterMs(response);
      await cancelBody(response);
      await sleep(retryAfter ?? backoff(attempt, retryBaseMs));
      continue;
    }

    const reason: LookupFailureReason =
      response.status === 429
        ? 'rate_limited'
        : response.status >= 500
          ? 'server_error'
          : 'unknown';
    throw new ProviderError(
      provider,
      reason,
      `${provider} HTTP ${response.status}`,
    );
  }

  throw new ProviderError(provider, 'unknown', `${provider} request failed`);
}

async function readCappedText(
  response: Response,
  provider: string,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelBody(response);
    throw new ProviderError(
      provider,
      'unknown',
      `${provider} response is too large: ${contentLength} bytes; the cap is ${maxBytes}`,
    );
  }

  const text = await response.text();
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    throw new ProviderError(
      provider,
      'unknown',
      `${provider} response is too large: ${bytes} bytes; the cap is ${maxBytes}`,
    );
  }
  return text;
}

function backoff(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function retryAfterMs(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value * 1000, MAX_RETRY_DELAY_MS);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be consumed or unusable.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}