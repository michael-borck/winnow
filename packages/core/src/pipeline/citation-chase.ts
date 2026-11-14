import { randomUUID } from 'node:crypto';
import type { SearchResult, VerificationRecord } from '../types.js';
import {
  fetchCitationCandidates,
  sampleCitationCandidates,
  type CitationChaseOptions,
} from '../retrieval/semanticScholar.js';
import { dedupeCandidates } from './dedupe.js';
import { rankCandidates } from './rank.js';
import { verifySource } from '../verification/cite-sight-adapter.js';
import { isCitable } from '../verification/citability.js';
import { mapLimit } from '../util/async.js';

export async function runCitationChase(
  doi: string,
  options: CitationChaseOptions,
): Promise<SearchResult> {
  const startedAt = new Date().toISOString();
  const { candidates, payload } = await fetchCitationCandidates(doi, options);
  const sampled = sampleCitationCandidates(candidates, options.limit);
  const merged = dedupeCandidates(sampled);

  const verified = await mapLimit(merged, 4, async (candidate) => {
    const verification = await verifySource(candidate.source, {
      mailto: options.mailto,
      checkLinks: false,
    });
    return [candidate.source.id, verification] as const;
  });

  const verifications = new Map<string, VerificationRecord>(verified);
  const ranked = rankCandidates(merged, verifications, {
    limit: options.limit,
  });
  const selected = ranked.filter((source) => source.selected);

  return {
    runId: makeRunId(),
    query: `citations of ${doi}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    retrieved: candidates.length,
    unique: merged.length,
    selectedCount: selected.length,
    citableCount: selected.filter((source) => isCitable(source.citability))
      .length,
    sources: ranked,
    failures: [],
    payloads: [payload],
  };
}

function makeRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `run-${stamp}-${randomUUID().slice(0, 6)}`;
}
