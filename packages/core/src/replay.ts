import type { DatabaseSync } from 'node:sqlite';
import type {
  ProviderReference,
  RankedSource,
  ReplayResult,
  ReplaySnapshot,
  RetrievedCandidate,
  VerificationRecord,
  Citability,
} from './types.js';
import { citability } from './verification/citability.js';
import { stableHash } from './text/ids.js';
import {
  getPayloads,
  getRun,
  loadRunSources,
  readPayload,
  type PayloadRow,
  type StoredSource,
} from './project/db.js';
import { normaliseOpenAlexBody } from './retrieval/openalex.js';
import { normaliseCrossrefBody } from './retrieval/crossref.js';
import {
  normaliseSemanticScholarBody,
  sampleCitationCandidates,
} from './retrieval/semanticScholar.js';
import { dedupeCandidates } from './pipeline/dedupe.js';
import { rankCandidates } from './pipeline/rank.js';

interface SnapshotInput {
  source: {
    id: string;
    title: string;
    doi?: string;
    year: number | null;
  };
  verification: VerificationRecord;
  citability: Citability;
  rrfScore: number;
  rank: number;
  selected: boolean;
  providers: ProviderReference[];
}

export function buildSnapshot(
  runId: string,
  query: string,
  sources: SnapshotInput[],
): ReplaySnapshot {
  const ordered = [...sources].sort((a, b) => a.rank - b.rank);

  return {
    runId,
    query,
    sources: ordered.map((item) => ({
      id: item.source.id,
      title: item.source.title,
      doi: item.source.doi ?? null,
      year: item.source.year,
      providers: [...item.providers]
        .sort((a, b) => a.provider.localeCompare(b.provider) || a.rank - b.rank)
        .map((provider) => ({
          provider: provider.provider,
          rank: provider.rank,
          ...(provider.payloadId ? { payloadId: provider.payloadId } : {}),
        })),
      rrfScore: item.rrfScore,
      rank: item.rank,
      selected: item.selected,
      verification: {
        identity: item.verification.identity,
        matchCategory: item.verification.matchCategory,
        integrity: [...item.verification.integrity].sort(),
        linkStatus: item.verification.linkStatus,
        completeness: item.verification.completeness.status,
        confidence: item.verification.confidence,
      },
      citability: item.citability,
    })),
  };
}

export function hashSnapshot(snapshot: ReplaySnapshot): string {
  return stableHash(JSON.stringify(snapshot));
}

export async function replayRun(
  db: DatabaseSync,
  projectRoot: string,
  runId: string,
): Promise<ReplayResult> {
  const run = getRun(db, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.output_sha256) {
    throw new Error(`Run ${runId} has no stored output hash; it cannot be replayed`);
  }

  const problems: string[] = [];
  const payloads = getPayloads(db, runId);
  if (!payloads.length) problems.push('No provider payloads stored for this run');

  const stored = loadRunSources(db, runId);
  const storedById = new Map(stored.map((item) => [item.source.id, item]));
  const limit = configLimit(run.config_json, stored.length);
  const payloadCandidates: RetrievedCandidate[] = [];

  for (const payload of payloads) {
    let body: string;
    try {
      body = await readPayload(projectRoot, payload);
    } catch (error) {
      problems.push(
        `Payload ${payload.id} unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const actual = stableHash(body);
    if (actual !== payload.sha256) {
      problems.push(`Payload ${payload.id} hash mismatch`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      problems.push(
        `Payload ${payload.id} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    try {
      payloadCandidates.push(...normalisePayload(payload, parsed, limit));
    } catch (error) {
      problems.push(
        `Payload ${payload.id} could not be normalised: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const merged = dedupeCandidates(payloadCandidates);
  const verifications = new Map<string, VerificationRecord>();
  for (const candidate of merged) {
    const storedSource = storedById.get(candidate.source.id);
    if (storedSource) {
      verifications.set(candidate.source.id, storedSource.verification);
    } else {
      problems.push(
        `Replay produced a source not in the stored run: ${candidate.source.id}`,
      );
      verifications.set(
        candidate.source.id,
        pendingVerification(candidate.providers[0]?.provider ?? 'replay'),
      );
    }
  }

  const replayedIds = new Set(merged.map((item) => item.source.id));
  for (const item of stored) {
    if (!replayedIds.has(item.source.id)) {
      problems.push(
        `Stored source missing from payload replay: ${item.source.id}`,
      );
    }
  }

  const ranked = rankCandidates(merged, verifications, {
    limit: limit > 0 ? limit : merged.length,
  });
  const snapshot = buildSnapshot(runId, run.query, ranked);
  const replayedHash = hashSnapshot(snapshot);

  return {
    runId,
    ok: problems.length === 0 && replayedHash === run.output_sha256,
    storedHash: run.output_sha256,
    replayedHash,
    sourceCount: merged.length,
    payloadCount: payloads.length,
    problems:
      replayedHash === run.output_sha256
        ? problems
        : [...problems, 'Snapshot hash does not match the stored output hash'],
  };
}

export function snapshotForRankedSources(
  runId: string,
  query: string,
  sources: RankedSource[],
): ReplaySnapshot {
  return buildSnapshot(runId, query, sources);
}

function normalisePayload(
  payload: PayloadRow,
  body: unknown,
  limit: number,
): RetrievedCandidate[] {
  if (payload.provider === 'openalex') {
    return normaliseOpenAlexBody(body).map((item) => ({
      source: item.source,
      provider: 'openalex',
      providerRank: item.providerRank,
      payloadId: payload.id,
    }));
  }
  if (payload.provider === 'crossref') {
    return normaliseCrossrefBody(body).map((item) => ({
      source: item.source,
      provider: 'crossref',
      providerRank: item.providerRank,
      payloadId: payload.id,
    }));
  }
  if (payload.provider === 'semantic_scholar') {
    return sampleCitationCandidates(
      normaliseSemanticScholarBody(body).map((item) => ({
        source: item.source,
        provider: 'semantic_scholar',
        providerRank: item.providerRank,
        payloadId: payload.id,
      })),
      limit,
    );
  }
  throw new Error(`unsupported provider ${payload.provider}`);
}

function configLimit(configJson: string, fallback: number): number {
  try {
    const config = JSON.parse(configJson) as { limit?: unknown };
    if (typeof config.limit === 'number' && config.limit > 0) {
      return Math.trunc(config.limit);
    }
  } catch {
    // Use the fallback.
  }
  return fallback;
}

function pendingVerification(provider: string): VerificationRecord {
  return {
    identity: 'unverified',
    matchCategory: 'none',
    integrity: ['none_found'],
    linkStatus: 'no_url',
    completeness: {
      status: 'incomplete',
      service: 'replay',
      reason: 'unknown',
    },
    confidence: 0,
    provider,
    checkedAt: new Date().toISOString(),
    evidence: { reason: 'source not present in the stored run' },
  };
}
