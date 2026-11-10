import type { ProviderFailure, RetrievalResult } from '../types.js';
import { retrieveCrossref } from './crossref.js';
import { retrieveOpenAlex } from './openalex.js';

export interface RetrieveOptions {
  limit: number;
  since?: number;
  until?: number;
  mailto?: string;
  providers?: string[];
}

export async function retrieve(
  topic: string,
  options: RetrieveOptions,
): Promise<RetrievalResult> {
  const requested = options.providers?.length ? options.providers : ['openalex', 'crossref'];
  const providers = [...new Set(requested.map((provider) => provider.toLowerCase()))];
  const failures: ProviderFailure[] = [];

  const tasks = providers.map(async (provider) => {
    if (provider === 'openalex') {
      return retrieveOpenAlex(topic, options);
    }
    if (provider === 'crossref') {
      return retrieveCrossref(topic, options);
    }
    throw Object.assign(new Error(`Unknown provider: ${provider}`), {
      provider,
      reason: 'unknown',
    });
  });

  const settled = await Promise.allSettled(tasks);
  const candidates = [];
  const payloads = [];

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index]!;
    const provider = providers[index]!;
    if (result.status === 'fulfilled') {
      candidates.push(...result.value.candidates);
      payloads.push(result.value.payload);
    } else {
      failures.push({
        provider,
        reason: String((result.reason as { reason?: unknown })?.reason ?? 'unknown'),
        message:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  return { candidates, payloads, failures };
}

const TYPE_ALIASES: Record<string, string> = {
  'journal-article': 'article',
  'posted-content': 'preprint',
  'proceedings-article': 'conference',
  'book-chapter': 'chapter',
  dissertation: 'thesis',
};

export function normaliseSourceType(type: string | undefined): string {
  if (!type) return 'unknown';
  const clean = type.toLowerCase().replace(/[_\s]+/g, '-');
  return TYPE_ALIASES[clean] ?? clean;
}

export function matchesType(type: string | undefined, filter: string | undefined): boolean {
  if (!filter) return true;
  const wanted = normaliseSourceType(filter);
  const actual = normaliseSourceType(type);
  return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
}
