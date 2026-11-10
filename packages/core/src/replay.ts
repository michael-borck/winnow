import type { DatabaseSync } from 'node:sqlite';
import type {
  ProviderReference,
  RankedSource,
  ReplayResult,
  ReplaySnapshot,
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
  type StoredSource,
} from './project/db.js';

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

  for (const payload of payloads) {
    try {
      const body = await readPayload(projectRoot, payload);
      const actual = stableHash(body);
      if (actual !== payload.sha256) {
        problems.push(`Payload ${payload.id} hash mismatch`);
      }
    } catch (error) {
      problems.push(
        `Payload ${payload.id} unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const stored = loadRunSources(db, runId);
  const snapshot = buildSnapshot(
    runId,
    run.query,
    stored.map((item: StoredSource) => ({
      ...item,
      citability: citability(item.verification),
    })),
  );
  const replayedHash = hashSnapshot(snapshot);

  return {
    runId,
    ok: problems.length === 0 && replayedHash === run.output_sha256,
    storedHash: run.output_sha256,
    replayedHash,
    sourceCount: stored.length,
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
