import type { ModelArtifact } from '../types.js';

export interface VerifyModelArtifactOptions {
  baseUrl: string;
  model: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

interface OllamaTag {
  name?: string;
  model?: string;
  digest?: string;
  size?: number;
  modified_at?: string;
  details?: {
    quantization_level?: string;
    parameter_size?: string;
    family?: string;
    format?: string;
  };
}

interface OllamaTagsResult {
  ok: boolean;
  models: OllamaTag[];
  error?: string;
}

interface OpenAiModelsResult {
  ok: boolean;
  ids: string[];
  error?: string;
}

export async function verifyModelArtifact(
  options: VerifyModelArtifactOptions,
): Promise<ModelArtifact> {
  const fetchImpl =
    options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 5_000;
  const verifiedAt = new Date().toISOString();
  const base = {
    name: options.model,
    endpoint: options.baseUrl,
    verifiedAt,
  };

  const tags = await fetchOllamaTags(fetchImpl, options.baseUrl, timeoutMs);
  if (tags.ok) {
    const match = tags.models.find(
      (item) => item.name === options.model || item.model === options.model,
    );
    if (match) {
      const digest =
        typeof match.digest === 'string' && match.digest.trim()
          ? match.digest.trim()
          : null;
      return {
        ...base,
        digest,
        quantization: match.details?.quantization_level ?? null,
        source: 'ollama',
        revision: match.modified_at ?? null,
        size: typeof match.size === 'number' ? match.size : null,
        verified: Boolean(digest),
        ...(match.details ? { details: match.details } : {}),
        ...(digest
          ? {}
          : { error: 'Ollama did not report a digest for this model' }),
      };
    }
  }

  const models = await fetchOpenAiModels(
    fetchImpl,
    options.baseUrl,
    timeoutMs,
  );
  if (models.ok) {
    const available = models.ids.includes(options.model);
    return {
      ...base,
      digest: null,
      quantization: null,
      source: tags.ok ? 'ollama' : 'openai-compatible',
      revision: null,
      size: null,
      verified: false,
      details: { availableModels: models.ids.length },
      ...(!available
        ? {
            error: tags.ok
              ? `model ${options.model} not found in Ollama tags or the model list`
              : `model ${options.model} not listed by the endpoint`,
          }
        : {}),
    };
  }

  return {
    ...base,
    digest: null,
    quantization: null,
    source: 'unknown',
    revision: null,
    size: null,
    verified: false,
    error: `could not inspect the model endpoint: ${tags.error ?? models.error ?? 'unknown error'}`,
  };
}

async function fetchOllamaTags(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  timeoutMs: number,
): Promise<OllamaTagsResult> {
  const url = ollamaTagsUrl(baseUrl);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, models: [], error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { models?: unknown };
    const models = Array.isArray(body.models)
      ? (body.models as OllamaTag[])
      : [];
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: messageOf(error) };
  }
}

async function fetchOpenAiModels(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  timeoutMs: number,
): Promise<OpenAiModelsResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, ids: [], error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { data?: unknown };
    const ids = Array.isArray(body.data)
      ? body.data
          .map((item) => {
            if (!item || typeof item !== 'object') return undefined;
            const value = (item as { id?: unknown }).id;
            return typeof value === 'string' ? value : undefined;
          })
          .filter((value): value is string => Boolean(value))
      : [];
    return { ok: true, ids };
  } catch (error) {
    return { ok: false, ids: [], error: messageOf(error) };
  }
}

function ollamaTagsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/v1$/.test(trimmed)) {
    return trimmed.replace(/\/v1$/, '/api/tags');
  }
  return `${trimmed}/api/tags`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}