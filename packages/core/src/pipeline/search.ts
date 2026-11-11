import { randomUUID } from 'node:crypto';
import type {
  SearchOptions,
  SearchResult,
  VerificationRecord,
} from '../types.js';
import { retrieve, matchesType } from '../retrieval/index.js';
import { dedupeCandidates } from './dedupe.js';
import { rankCandidates } from './rank.js';
import { verifySource } from '../verification/cite-sight-adapter.js';
import { isCitable } from '../verification/citability.js';
import { mapLimit } from '../util/async.js';

export async function searchLiterature(
  topic: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const startedAt = new Date().toISOString();
  const retrieval = await retrieve(topic, options);

  const typeFilters = options.types?.length
    ? options.types
    : options.type
      ? [options.type]
      : [];

  let filtered = typeFilters.length
    ? retrieval.candidates.filter((candidate) =>
        typeFilters.some((type) => matchesType(candidate.source.type, type)),
      )
    : retrieval.candidates;

  if (options.openAccessOnly) {
    filtered = filtered.filter((candidate) =>
      Boolean(candidate.source.openAccessUrl),
    );
  }

  const merged = dedupeCandidates(filtered);

  const verified = await mapLimit(merged, 4, async (candidate) => {
    const verification = await verifySource(candidate.source, {
      mailto: options.mailto,
      checkLinks: options.checkLinks ?? false,
    });
    return [candidate.source.id, verification] as const;
  });

  const verifications = new Map<string, VerificationRecord>(verified);
  const ranked = rankCandidates(merged, verifications, { limit: options.limit });
  const selected = ranked.filter((source) => source.selected);

  return {
    runId: makeRunId(),
    query: topic,
    startedAt,
    finishedAt: new Date().toISOString(),
    retrieved: retrieval.candidates.length,
    unique: merged.length,
    selectedCount: selected.length,
    citableCount: selected.filter((source) => isCitable(source.citability)).length,
    sources: ranked,
    failures: retrieval.failures,
    payloads: retrieval.payloads,
  };
}

function makeRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `run-${stamp}-${randomUUID().slice(0, 6)}`;
}
