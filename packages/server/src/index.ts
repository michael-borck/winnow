import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIELDS,
  dropHeldSentence,
  findProject,
  getDraft,
  getLatestDraft,
  getRun,
  heldSentences,
  listDrafts,
  listRuns,
  loadDraftSnapshot,
  loadExtractionState,
  loadScreeningState,
  openProject,
  recordScreeningDecision,
  restoreHeldSentence,
  type ScreeningDecision,
  type ScreeningReasonCode,
  type ScreeningRelevance,
} from '@michaelborck/winnow-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.WINNOW_PORT ?? 4317);
const rootArg =
  process.env.WINNOW_PROJECT ??
  process.argv.find((arg) => arg.startsWith('--project='))?.split('=')[1] ??
  process.cwd();

const found = await findProject(rootArg);
if (!found) {
  console.error(
    `winnow server: no Winnow project at ${rootArg}. Pass --project=/path/to/project.`,
  );
  process.exit(1);
}

const project = await openProject(found);
const sessionToken = randomUUID();
const app = express();

app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path === '/session') return next();
  if (req.get('x-winnow-token') !== sessionToken) {
    res.status(403).json({ error: 'Invalid session token' });
    return;
  }
  next();
});

app.get('/api/session', (_req, res) => {
  res.json({ token: sessionToken, project: project.meta.name });
});

app.get('/api/state', (req, res) => {
  const runId = typeof req.query.run === 'string' ? req.query.run : undefined;
  const runs = listRuns(project.db, 30);
  const run = runId
    ? getRun(project.db, runId) ?? null
    : runs.find((item) => item.status !== 'running') ?? null;
  if (!run) {
    res.json({
      project: { name: project.meta.name, root: project.root },
      run: null,
      runs: runs.map(runSummary),
      counts: null,
      drafts: [],
      heldCount: 0,
    });
    return;
  }

  const screening = loadScreeningState(project.db, run.id);
  const evidence = loadExtractionState(project.db, run.id, DEFAULT_FIELDS);
  const drafts = listDrafts(project.db, run.id);
  const latest = drafts[0];
  let heldCount = 0;
  if (latest) {
    try {
      heldCount = heldSentences(loadDraftSnapshot(latest).draft).length;
    } catch {
      heldCount = 0;
    }
  }

  res.json({
    project: { name: project.meta.name, root: project.root },
    run: runSummary(run),
    runs: runs.map(runSummary),
    counts: {
      screening: screening.counts,
      evidence: evidence.counts,
    },
    drafts: drafts.map(draftSummary),
    heldCount,
  });
});

app.get('/api/sources', (req, res) => {
  const run = runFromQuery(req);
  if (!run) {
    res.status(404).json({ error: 'No completed run found' });
    return;
  }
  const screening = loadScreeningState(project.db, run.id);
  res.json({
    run: runSummary(run),
    counts: screening.counts,
    sources: screening.sources.map((item) => ({
      id: item.source.id,
      title: item.source.title,
      authors: item.source.authors,
      year: item.source.year,
      venue: item.source.venue ?? null,
      doi: item.source.doi ?? null,
      url: item.source.url ?? null,
      abstract: item.source.abstract ?? null,
      citability: item.citability,
      decision: item.decision ?? null,
      relevance: item.relevance ?? null,
      reasonCode: item.reasonCode ?? null,
      reason: item.reason ?? null,
      reviewer: item.reviewer ?? null,
      filterFlags: item.filterFlags,
      rank: item.rank,
    })),
  });
});

app.post('/api/screen', (req, res) => {
  const {
    runId,
    sourceId,
    decision,
    relevance,
    reasonCode,
    reason,
    reviewer,
  } = req.body as {
    runId?: string;
    sourceId?: string;
    decision?: ScreeningDecision;
    relevance?: ScreeningRelevance;
    reasonCode?: ScreeningReasonCode;
    reason?: string;
    reviewer?: string;
  };

  if (!runId || !sourceId || !isDecision(decision)) {
    res.status(400).json({ error: 'runId, sourceId and a valid decision are required' });
    return;
  }

  recordScreeningDecision(project.db, {
    runId,
    sourceId,
    decision,
    relevance: isRelevance(relevance) ? relevance : undefined,
    reasonCode: isReasonCode(reasonCode) ? reasonCode : undefined,
    reason,
    reviewer: reviewer?.trim() || 'web',
  });
  res.json({ ok: true });
});

app.get('/api/evidence', (req, res) => {
  const run = runFromQuery(req);
  if (!run) {
    res.status(404).json({ error: 'No completed run found' });
    return;
  }
  const summary = loadExtractionState(project.db, run.id, DEFAULT_FIELDS);
  res.json({
    run: runSummary(run),
    fields: summary.fields,
    counts: summary.counts,
    rows: summary.rows,
  });
});

app.get('/api/drafts', (req, res) => {
  const runId = typeof req.query.run === 'string' ? req.query.run : undefined;
  res.json({ drafts: listDrafts(project.db, runId).map(draftSummary) });
});

app.get('/api/drafts/:id', (req, res) => {
  const row = getDraft(project.db, req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  res.json({
    ...draftSummary(row),
    markdown: row.markdown,
    structured: JSON.parse(row.structured_json) as unknown,
  });
});

app.get('/api/queue', (req, res) => {
  const draftId = typeof req.query.draft === 'string' ? req.query.draft : undefined;
  const runId = typeof req.query.run === 'string' ? req.query.run : undefined;
  const row = draftId
    ? getDraft(project.db, draftId)
    : getLatestDraft(project.db, runId);
  if (!row) {
    res.status(404).json({ error: 'No draft found' });
    return;
  }
  try {
    const { draft } = loadDraftSnapshot(row);
    res.json({
      draft: draftSummary(row),
      held: heldSentences(draft),
    });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/queue/restore', (req, res) => {
  const { draftId, sentenceId, reviewer, rationale } = req.body as {
    draftId?: string;
    sentenceId?: string;
    reviewer?: string;
    rationale?: string;
  };
  if (!draftId || !sentenceId) {
    res.status(400).json({ error: 'draftId and sentenceId are required' });
    return;
  }
  try {
    const result = restoreHeldSentence(project.db, {
      draftId,
      sentenceId,
      reviewer: reviewer?.trim() || 'web',
      rationale,
    });
    res.json({ draftId: result.draft.id, sentence: result.sentence });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/queue/drop', (req, res) => {
  const { draftId, sentenceId, reviewer, rationale } = req.body as {
    draftId?: string;
    sentenceId?: string;
    reviewer?: string;
    rationale?: string;
  };
  if (!draftId || !sentenceId) {
    res.status(400).json({ error: 'draftId and sentenceId are required' });
    return;
  }
  try {
    const result = dropHeldSentence(project.db, {
      draftId,
      sentenceId,
      reviewer: reviewer?.trim() || 'web',
      rationale,
    });
    res.json({ draftId: result.draft.id, sentence: result.sentence });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const webDist = path.resolve(__dirname, '../../web/dist');
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    !req.path.startsWith('/api') &&
    existsSync(path.join(webDist, 'index.html'))
  ) {
    res.sendFile(path.join(webDist, 'index.html'));
    return;
  }
  next();
});

app.use(
  (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  },
);

app.listen(port, '127.0.0.1', () => {
  console.log(`Winnow web UI: http://127.0.0.1:${port}`);
  console.log(`Project: ${project.root}`);
});

process.on('SIGINT', () => {
  project.db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  project.db.close();
  process.exit(0);
});

function runFromQuery(req: Request) {
  const runId = typeof req.query.run === 'string' ? req.query.run : undefined;
  const runs = listRuns(project.db, 30);
  return runId
    ? getRun(project.db, runId)
    : runs.find((item) => item.status !== 'running') ?? null;
}

function runSummary(row: NonNullable<ReturnType<typeof getRun>>) {
  return {
    id: row.id,
    query: row.query,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function draftSummary(row: ReturnType<typeof listDrafts>[number]) {
  return {
    id: row.id,
    runId: row.run_id,
    parentId: row.parent_id,
    mode: row.mode,
    writer: row.writer,
    model: row.model,
    createdAt: row.created_at,
  };
}

function isDecision(value: unknown): value is ScreeningDecision {
  return value === 'include' || value === 'exclude' || value === 'maybe';
}

function isRelevance(value: unknown): value is ScreeningRelevance {
  return value === 'core' || value === 'supporting' || value === 'peripheral';
}

function isReasonCode(value: unknown): value is ScreeningReasonCode {
  return (
    value === 'off_topic' ||
    value === 'wrong_population' ||
    value === 'wrong_method' ||
    value === 'not_empirical' ||
    value === 'duplicate' ||
    value === 'not_accessible' ||
    value === 'out_of_scope_date' ||
    value === 'out_of_scope_venue' ||
    value === 'other'
  );
}
