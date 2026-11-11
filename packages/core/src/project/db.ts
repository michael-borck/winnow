import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AcademicSource,
  IntegrityNotice,
  LinkStatus,
  ProviderReference,
  RankedSource,
  RetrievalPayload,
  VerificationRecord,
} from '../types.js';
import { citability } from '../verification/citability.js';
import { normaliseText } from '../text/normalise.js';
import { stableHash } from '../text/ids.js';
import { briefId, type Brief } from '../brief/brief.js';

export interface RunRow {
  id: string;
  project_id: string | null;
  started_at: string;
  finished_at: string | null;
  query: string;
  config_json: string;
  stages_json: string;
  component_health_json: string;
  output_sha256: string | null;
  status: string;
}

export interface PayloadRow {
  id: string;
  run_id: string;
  provider: string;
  query: string;
  url: string | null;
  fetched_at: string;
  sha256: string;
  compression: string;
  path: string;
  size: number;
}

export interface StoredSource {
  source: AcademicSource;
  verification: VerificationRecord;
  rrfScore: number;
  rank: number;
  selected: boolean;
  providers: ProviderReference[];
}

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      query TEXT NOT NULL,
      config_json TEXT NOT NULL,
      stages_json TEXT NOT NULL DEFAULT '{}',
      component_health_json TEXT NOT NULL DEFAULT '{}',
      output_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      question TEXT,
      thesis TEXT,
      mode TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      counter INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors_json TEXT NOT NULL,
      year INTEGER,
      venue TEXT,
      type TEXT,
      citation_count INTEGER,
      citation_provider TEXT,
      citation_collected_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identifiers (
      source_id TEXT NOT NULL,
      scheme TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (source_id, scheme, value),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS verifications (
      source_id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      match_category TEXT NOT NULL,
      integrity_json TEXT NOT NULL,
      link_status TEXT NOT NULL,
      completeness_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      provider TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS source_text (
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      normalised_text TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      licence TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (source_id, kind),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS raw_payloads (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      query TEXT NOT NULL,
      url TEXT,
      fetched_at TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      compression TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_sources (
      run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      query TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_rank INTEGER,
      rrf_score REAL NOT NULL,
      rank INTEGER NOT NULL,
      selected INTEGER NOT NULL,
      raw_payload_id TEXT,
      PRIMARY KEY (run_id, source_id, provider),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  const existing = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;

  if (!existing) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      1,
      new Date().toISOString(),
    );
  }
}

export function createRun(
  db: DatabaseSync,
  input: { id: string; query: string; config: Record<string, unknown> },
): void {
  db.prepare(
    `INSERT INTO runs (id, project_id, started_at, query, config_json, stages_json, component_health_json, status)
     VALUES (?, NULL, ?, ?, ?, '{}', '{}', 'running')`,
  ).run(input.id, new Date().toISOString(), input.query, JSON.stringify(input.config));
}

export function saveBrief(db: DatabaseSync, brief: Brief): string {
  const id = briefId(brief);
  db.prepare(
    `INSERT INTO briefs
     (id, project_id, question, thesis, mode, scope_json, filters_json, criteria_json, counter, raw_text, path, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       question = excluded.question,
       thesis = excluded.thesis,
       mode = excluded.mode,
       scope_json = excluded.scope_json,
       filters_json = excluded.filters_json,
       criteria_json = excluded.criteria_json,
       counter = excluded.counter,
       raw_text = excluded.raw_text,
       path = excluded.path`,
  ).run(
    id,
    brief.question ?? null,
    brief.thesis ?? null,
    brief.mode,
    JSON.stringify(brief.scope),
    JSON.stringify(brief.filters),
    JSON.stringify(brief.criteria),
    brief.counter ? 1 : 0,
    brief.raw,
    brief.path ?? null,
    new Date().toISOString(),
  );
  return id;
}

export async function savePayload(
  db: DatabaseSync,
  projectRoot: string,
  runId: string,
  payload: RetrievalPayload,
): Promise<string> {
  const directory = path.join(projectRoot, 'payloads');
  await mkdir(directory, { recursive: true });

  const relativePath = path.join('payloads', `${payload.id}.json.gz`);
  const absolutePath = path.join(projectRoot, relativePath);
  const compressed = gzipSync(Buffer.from(payload.body, 'utf8'));

  await writeFile(absolutePath, compressed);
  db.prepare(
    `INSERT OR REPLACE INTO raw_payloads
     (id, run_id, provider, query, url, fetched_at, sha256, compression, path, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'gzip', ?, ?)`,
  ).run(
    payload.id,
    runId,
    payload.provider,
    payload.query,
    payload.url,
    payload.fetchedAt,
    stableHash(payload.body),
    relativePath,
    compressed.byteLength,
  );

  return payload.id;
}

export function saveRunSources(
  db: DatabaseSync,
  runId: string,
  query: string,
  sources: RankedSource[],
): void {
  const insertSource = db.prepare(
    `INSERT INTO sources
     (id, title, authors_json, year, venue, type, citation_count, citation_provider, citation_collected_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       authors_json = excluded.authors_json,
       year = excluded.year,
       venue = excluded.venue,
       type = excluded.type,
       citation_count = excluded.citation_count,
       citation_provider = excluded.citation_provider,
       citation_collected_at = excluded.citation_collected_at`,
  );
  const insertIdentifier = db.prepare(
    `INSERT OR IGNORE INTO identifiers (source_id, scheme, value) VALUES (?, ?, ?)`,
  );
  const insertVerification = db.prepare(
    `INSERT INTO verifications
     (source_id, identity, match_category, integrity_json, link_status, completeness_json, confidence, provider, checked_at, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       identity = excluded.identity,
       match_category = excluded.match_category,
       integrity_json = excluded.integrity_json,
       link_status = excluded.link_status,
       completeness_json = excluded.completeness_json,
       confidence = excluded.confidence,
       provider = excluded.provider,
       checked_at = excluded.checked_at,
       evidence_json = excluded.evidence_json`,
  );
  const insertText = db.prepare(
    `INSERT INTO source_text
     (source_id, kind, text, normalised_text, sha256, licence, fetched_at)
     VALUES (?, 'abstract', ?, ?, ?, NULL, ?)
     ON CONFLICT(source_id, kind) DO UPDATE SET
       text = excluded.text,
       normalised_text = excluded.normalised_text,
       sha256 = excluded.sha256,
       fetched_at = excluded.fetched_at`,
  );
  const insertRunSource = db.prepare(
    `INSERT OR REPLACE INTO run_sources
     (run_id, source_id, query, provider, provider_rank, rrf_score, rank, selected, raw_payload_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const item of sources) {
      const { source, verification } = item;
      insertSource.run(
        source.id,
        source.title,
        JSON.stringify(source.authors),
        source.year,
        source.venue ?? null,
        source.type ?? null,
        source.citationCount ?? null,
        source.citationProvider ?? null,
        source.citationCollectedAt ?? null,
        new Date().toISOString(),
      );

      if (source.doi) insertIdentifier.run(source.id, 'doi', source.doi.toLowerCase());
      if (source.url) insertIdentifier.run(source.id, 'url', source.url);

      insertVerification.run(
        source.id,
        verification.identity,
        verification.matchCategory,
        JSON.stringify(verification.integrity),
        verification.linkStatus,
        JSON.stringify(verification.completeness),
        verification.confidence,
        verification.provider,
        verification.checkedAt,
        JSON.stringify(verification.evidence),
      );

      if (source.abstract) {
        const normalised = normaliseText(source.abstract);
        insertText.run(
          source.id,
          source.abstract,
          normalised,
          stableHash(normalised),
          new Date().toISOString(),
        );
      }

      for (const provider of item.providers) {
        insertRunSource.run(
          runId,
          source.id,
          query,
          provider.provider,
          provider.rank,
          item.rrfScore,
          item.rank,
          item.selected ? 1 : 0,
          provider.payloadId ?? null,
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function finishRun(
  db: DatabaseSync,
  runId: string,
  input: {
    outputSha256: string;
    stages: Record<string, unknown>;
    componentHealth: Record<string, unknown>;
  },
): void {
  db.prepare(
    `UPDATE runs
     SET finished_at = ?, stages_json = ?, component_health_json = ?, output_sha256 = ?, status = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    JSON.stringify(input.stages),
    JSON.stringify(input.componentHealth),
    input.outputSha256,
    input.componentHealth.failed ? 'partial' : 'ok',
    runId,
  );
}

export function getRun(db: DatabaseSync, runId: string): RunRow | null {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
    | RunRow
    | undefined;
  return row ?? null;
}

export function getPayloads(db: DatabaseSync, runId: string): PayloadRow[] {
  return db
    .prepare('SELECT * FROM raw_payloads WHERE run_id = ? ORDER BY provider ASC')
    .all(runId) as unknown as PayloadRow[];
}

export function loadRunSources(db: DatabaseSync, runId: string): StoredSource[] {
  const rows = db
    .prepare('SELECT * FROM run_sources WHERE run_id = ? ORDER BY rank ASC, provider ASC')
    .all(runId) as Array<{
    run_id: string;
    source_id: string;
    query: string;
    provider: string;
    provider_rank: number | null;
    rrf_score: number;
    rank: number;
    selected: number;
    raw_payload_id: string | null;
  }>;

  const bySource = new Map<string, StoredSource>();

  for (const row of rows) {
    let item = bySource.get(row.source_id);
    if (!item) {
      const sourceRow = db
        .prepare('SELECT * FROM sources WHERE id = ?')
        .get(row.source_id) as
        | {
            id: string;
            title: string;
            authors_json: string;
            year: number | null;
            venue: string | null;
            type: string | null;
            citation_count: number | null;
            citation_provider: string | null;
            citation_collected_at: string | null;
          }
        | undefined;
      const verificationRow = db
        .prepare('SELECT * FROM verifications WHERE source_id = ?')
        .get(row.source_id) as
        | {
            identity: VerificationRecord['identity'];
            match_category: VerificationRecord['matchCategory'];
            integrity_json: string;
            link_status: LinkStatus;
            completeness_json: string;
            confidence: number;
            provider: string;
            checked_at: string;
            evidence_json: string;
          }
        | undefined;
      if (!sourceRow || !verificationRow) {
        throw new Error(`Incomplete stored record for ${row.source_id}`);
      }

      const doiRow = db
        .prepare("SELECT value FROM identifiers WHERE source_id = ? AND scheme = 'doi' LIMIT 1")
        .get(row.source_id) as { value: string } | undefined;

      const source: AcademicSource = {
        id: sourceRow.id,
        title: sourceRow.title,
        authors: JSON.parse(sourceRow.authors_json) as string[],
        year: sourceRow.year,
        venue: sourceRow.venue ?? undefined,
        type: sourceRow.type ?? undefined,
        doi: doiRow?.value,
        citationCount: sourceRow.citation_count ?? undefined,
        citationProvider: sourceRow.citation_provider ?? undefined,
        citationCollectedAt: sourceRow.citation_collected_at ?? undefined,
        sourceProvider: 'stored',
      };

      const verification: VerificationRecord = {
        identity: verificationRow.identity,
        matchCategory: verificationRow.match_category,
        integrity: JSON.parse(verificationRow.integrity_json) as IntegrityNotice[],
        linkStatus: verificationRow.link_status,
        completeness: JSON.parse(verificationRow.completeness_json) as VerificationRecord['completeness'],
        confidence: verificationRow.confidence,
        provider: verificationRow.provider,
        checkedAt: verificationRow.checked_at,
        evidence: JSON.parse(verificationRow.evidence_json) as Record<string, unknown>,
      };

      item = {
        source,
        verification,
        rrfScore: row.rrf_score,
        rank: row.rank,
        selected: row.selected === 1,
        providers: [],
      };
      bySource.set(row.source_id, item);
    }

    item.providers.push({
      provider: row.provider,
      rank: row.provider_rank ?? 0,
      payloadId: row.raw_payload_id ?? undefined,
    });
  }

  return [...bySource.values()].sort((a, b) => a.rank - b.rank);
}

export async function readPayload(
  projectRoot: string,
  row: PayloadRow,
): Promise<string> {
  const absolutePath = path.join(projectRoot, row.path);
  const compressed = await readFile(absolutePath);
  return gunzipSync(compressed).toString('utf8');
}

export function recomputeCitability(
  source: StoredSource,
): ReturnType<typeof citability> {
  return citability(source.verification);
}
