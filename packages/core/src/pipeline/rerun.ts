import type { DatabaseSync } from 'node:sqlite';
import type {
  Citability,
  ProviderFailure,
  RankedSource,
  SearchResult,
  VerificationRecord,
} from '../types.js';
import { citability, isCitable } from '../verification/citability.js';
import { buildSnapshot, hashSnapshot } from '../replay.js';
import {
  getRun,
  loadRunSources,
  recordAuditEvent,
  type RunRow,
  type StoredSource,
} from '../project/db.js';
import { searchLiterature } from './search.js';
import { runCitationChase } from './citation-chase.js';

export interface RerunSourceDiff {
  id: string;
  title: string;
  status: 'added' | 'removed' | 'changed';
  storedRank?: number;
  liveRank?: number;
  storedSelected?: boolean;
  liveSelected?: boolean;
  storedCitability?: Citability;
  liveCitability?: Citability;
  changes: string[];
}

export interface RerunResult {
  runId: string;
  query: string;
  liveRunId: string;
  storedHash: string | null;
  liveHash: string;
  hashMatches: boolean | null;
  identical: boolean;
  storedCount: number;
  liveCount: number;
  storedSelectedCount: number;
  liveSelectedCount: number;
  storedCitableCount: number;
  liveCitableCount: number;
  added: number;
  removed: number;
  changed: number;
  failures: ProviderFailure[];
  problems: string[];
  sources: RerunSourceDiff[];
}

export interface RerunOptions {
  apiKey?: string;
  execute?: (run: RunRow) => Promise<SearchResult>;
  record?: boolean;
}

export class RerunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RerunError';
  }
}

export async function rerunRun(
  db: DatabaseSync,
  runId: string,
  options: RerunOptions = {},
): Promise<RerunResult> {
  const run = getRun(db, runId);
  if (!run) throw new RerunError(`Run not found: ${runId}`);

  const stored = loadRunSources(db, runId);
  const live = options.execute
    ? await options.execute(run)
    : await executeLiveRun(run, options.apiKey);
  const result = compareRerun(run, stored, live);

  if (options.record !== false) {
    recordAuditEvent(db, {
      runId,
      actor: 'system',
      action: 'rerun_live',
      payload: {
        liveRunId: result.liveRunId,
        identical: result.identical,
        storedHash: result.storedHash,
        liveHash: result.liveHash,
        storedCount: result.storedCount,
        liveCount: result.liveCount,
        added: result.added,
        removed: result.removed,
        changed: result.changed,
        failures: result.failures,
        problems: result.problems,
      },
    });
  }

  return result;
}

export function compareRerun(
  run: RunRow,
  stored: StoredSource[],
  live: SearchResult,
): RerunResult {
  const storedRanked: RankedSource[] = stored.map((item) => ({
    ...item,
    citability: citability(item.verification),
  }));
  const storedById = new Map(
    storedRanked.map((item) => [item.source.id, item]),
  );
  const liveById = new Map(live.sources.map((item) => [item.source.id, item]));

  const sources: RerunSourceDiff[] = [];

  for (const [id, liveItem] of liveById) {
    const storedItem = storedById.get(id);
    if (!storedItem) {
      sources.push({
        id,
        title: liveItem.source.title,
        status: 'added',
        liveRank: liveItem.rank,
        liveSelected: liveItem.selected,
        liveCitability: liveItem.citability,
        changes: ['added'],
      });
      continue;
    }

    const changes: string[] = [];
    if (storedItem.source.title !== liveItem.source.title) {
      changes.push('title changed');
    }
    const storedDoi = storedItem.source.doi ?? 'none';
    const liveDoi = liveItem.source.doi ?? 'none';
    if (storedDoi !== liveDoi) {
      changes.push(`doi ${storedDoi} -> ${liveDoi}`);
    }
    const storedYear = storedItem.source.year ?? 'none';
    const liveYear = liveItem.source.year ?? 'none';
    if (storedYear !== liveYear) {
      changes.push(`year ${storedYear} -> ${liveYear}`);
    }
    if (storedItem.rank !== liveItem.rank) {
      changes.push(`rank ${storedItem.rank} -> ${liveItem.rank}`);
    }
    if (storedItem.selected !== liveItem.selected) {
      changes.push(
        `selected ${storedItem.selected} -> ${liveItem.selected}`,
      );
    }
    if (storedItem.citability !== liveItem.citability) {
      changes.push(
        `citability ${storedItem.citability} -> ${liveItem.citability}`,
      );
    }
    changes.push(
      ...verificationChanges(
        storedItem.verification,
        liveItem.verification,
      ),
    );
    const storedProviders = providerKey(storedItem);
    const liveProviders = providerKey(liveItem);
    if (storedProviders !== liveProviders) {
      changes.push(
        `providers ${storedProviders || 'none'} -> ${liveProviders || 'none'}`,
      );
    }

    if (changes.length) {
      sources.push({
        id,
        title: liveItem.source.title,
        status: 'changed',
        storedRank: storedItem.rank,
        liveRank: liveItem.rank,
        storedSelected: storedItem.selected,
        liveSelected: liveItem.selected,
        storedCitability: storedItem.citability,
        liveCitability: liveItem.citability,
        changes,
      });
    }
  }

  for (const [id, storedItem] of storedById) {
    if (liveById.has(id)) continue;
    sources.push({
      id,
      title: storedItem.source.title,
      status: 'removed',
      storedRank: storedItem.rank,
      storedSelected: storedItem.selected,
      storedCitability: storedItem.citability,
      changes: ['removed'],
    });
  }

  sources.sort(
    (a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id),
  );

  const liveSnapshot = buildSnapshot(
    run.id,
    run.query,
    comparableLiveSources(storedRanked, live.sources),
  );
  const liveHash = hashSnapshot(liveSnapshot);
  const hashMatches =
    run.output_sha256 == null ? null : run.output_sha256 === liveHash;

  const problems: string[] = [];
  if (run.output_sha256 == null) {
    problems.push('Stored run has no output hash');
  }
  if (live.query !== run.query) {
    problems.push(`Live query differs: ${live.query}`);
  }
  if (!stored.length) problems.push('Stored run has no sources');
  if (!live.sources.length) problems.push('Live rerun returned no sources');

  const added = sources.filter((item) => item.status === 'added').length;
  const removed = sources.filter((item) => item.status === 'removed').length;
  const changed = sources.filter((item) => item.status === 'changed').length;

  return {
    runId: run.id,
    query: run.query,
    liveRunId: live.runId,
    storedHash: run.output_sha256,
    liveHash,
    hashMatches,
    identical: hashMatches === true && sources.length === 0,
    storedCount: storedRanked.length,
    liveCount: live.sources.length,
    storedSelectedCount: storedRanked.filter((item) => item.selected).length,
    liveSelectedCount: live.sources.filter((item) => item.selected).length,
    storedCitableCount: storedRanked.filter((item) => isCitable(item.citability))
      .length,
    liveCitableCount: live.sources.filter((item) => isCitable(item.citability))
      .length,
    added,
    removed,
    changed,
    failures: live.failures,
    problems,
    sources,
  };
}

export function formatRerunReport(
  result: RerunResult,
  options: { diff?: boolean } = {},
): string {
  const lines = [
    `Rerun ${result.runId} -> live ${result.liveRunId}`,
    `Stored: ${result.storedCount} sources, ${result.storedSelectedCount} selected, ` +
      `${result.storedCitableCount} citable; hash ${result.storedHash ?? 'none'}`,
    `Live:   ${result.liveCount} sources, ${result.liveSelectedCount} selected, ` +
      `${result.liveCitableCount} citable; hash ${result.liveHash}`,
    `Identical: ${result.identical ? 'yes' : 'no'}`,
    `Changes: ${result.added} added, ${result.removed} removed, ${result.changed} changed`,
  ];

  if (result.failures.length) {
    lines.push(
      `Provider failures: ${result.failures
        .map((failure) => `${failure.provider} (${failure.reason})`)
        .join(', ')}`,
    );
  }

  if (result.problems.length) {
    lines.push('Problems:');
    for (const problem of result.problems) lines.push(`  - ${problem}`);
  }

  if (options.diff) {
    if (!result.sources.length) {
      lines.push('No source changes.');
    } else {
      lines.push('Source changes:');
      for (const item of result.sources) {
        if (item.status === 'added') {
          lines.push(
            `  + ${item.id} ${item.title} (rank ${item.liveRank ?? 'unknown'})`,
          );
        } else if (item.status === 'removed') {
          lines.push(
            `  - ${item.id} ${item.title} (rank ${item.storedRank ?? 'unknown'})`,
          );
        } else {
          lines.push(
            `  ~ ${item.id} ${item.title}: ${item.changes.join('; ')}`,
          );
        }
      }
    }
  } else if (result.sources.length) {
    lines.push('Use --diff to list each source change.');
  }

  return `${lines.join('\n')}\n`;
}

async function executeLiveRun(
  run: RunRow,
  apiKey?: string,
): Promise<SearchResult> {
  const config = parseConfig(run.config_json);
  const limit = positiveInteger(config.limit) ?? 20;
  if (typeof config.chaseOf === 'string' && config.chaseOf.trim()) {
    return runCitationChase(config.chaseOf.trim(), {
      limit,
      mailto: stringValue(config.mailto),
      apiKey,
    });
  }

  return searchLiterature(run.query, {
    limit,
    since: integerValue(config.since),
    until: integerValue(config.until),
    type: stringValue(config.type),
    types: stringList(config.types),
    openAccessOnly: config.openAccessOnly === true,
    providers: providerList(config.providers),
    mailto: stringValue(config.mailto),
    checkLinks: config.checkLinks === true,
  });
}

function verificationChanges(
  stored: VerificationRecord,
  live: VerificationRecord,
): string[] {
  const changes: string[] = [];
  if (stored.identity !== live.identity) {
    changes.push(`identity ${stored.identity} -> ${live.identity}`);
  }
  if (stored.matchCategory !== live.matchCategory) {
    changes.push(`match ${stored.matchCategory} -> ${live.matchCategory}`);
  }
  const storedIntegrity = [...stored.integrity].sort().join(',');
  const liveIntegrity = [...live.integrity].sort().join(',');
  if (storedIntegrity !== liveIntegrity) {
    changes.push(`integrity ${storedIntegrity} -> ${liveIntegrity}`);
  }
  if (stored.linkStatus !== live.linkStatus) {
    changes.push(`link ${stored.linkStatus} -> ${live.linkStatus}`);
  }
  if (stored.completeness.status !== live.completeness.status) {
    changes.push(
      `completeness ${stored.completeness.status} -> ${live.completeness.status}`,
    );
  }
  if (stored.confidence !== live.confidence) {
    changes.push(`confidence ${stored.confidence} -> ${live.confidence}`);
  }
  if (stored.provider !== live.provider) {
    changes.push(`verification provider ${stored.provider} -> ${live.provider}`);
  }
  return changes;
}

function providerKey(item: RankedSource): string {
  return [...item.providers]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.rank - b.rank)
    .map((provider) => `${provider.provider}:${provider.rank}`)
    .join(', ');
}

function comparableLiveSources(
  stored: RankedSource[],
  live: RankedSource[],
): RankedSource[] {
  const payloads = new Map<string, string | undefined>();
  for (const item of stored) {
    for (const provider of item.providers) {
      payloads.set(
        `${item.source.id}|${provider.provider}`,
        provider.payloadId,
      );
    }
  }

  return live.map((item) => ({
    ...item,
    providers: item.providers.map((provider) => ({
      ...provider,
      payloadId: payloads.get(`${item.source.id}|${provider.provider}`),
    })),
  }));
}

function parseConfig(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()),
  );
  return items.length ? items : undefined;
}

function providerList(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return stringList(value);
}
