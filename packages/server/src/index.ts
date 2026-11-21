import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIELDS,
  applySupportCheck,
  buildEvidenceBundle,
  checkDraft,
  CitationError,
  dropHeldSentence,
  findProject,
  generateModelDraft,
  generateTemplateDraft,
  getDraft,
  getLatestDraft,
  getRun,
  heldSentences,
  listDrafts,
  listRuns,
  loadDraftSnapshot,
  loadExtractionState,
  loadScreeningState,
  ModelError,
  normaliseStyle,
  openProject,
  searchLiterature,
  createRun,
  savePayload,
  saveRunSources,
  finishRun,
  recordAuditEvent,
  hashSnapshot,
  snapshotForRankedSources,
  type RetrievalPayload,
  recordExtractionValue,
  recordScreeningDecision,
  registerCslStyle,
  renderDraftMarkdown,
  restoreHeldSentence,
  saveDraft,
  shortHash,
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

app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  next();
});

app.use((req, res, next) => {
  const host = req.get('host');
  if (!host) {
    res.status(400).json({ error: 'Missing Host header' });
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    res.status(400).json({ error: 'Invalid Host header' });
    return;
  }

  if (
    hostname !== '127.0.0.1' &&
    hostname !== 'localhost' &&
    hostname !== '::1'
  ) {
    res.status(403).json({ error: 'Invalid Host header' });
    return;
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api', (req, res, next) => {
  if (req.path === '/session') return next();
  if (req.get('x-winnow-token') !== sessionToken) {
    res.status(403).json({ error: 'Invalid session token' });
    return;
  }

  const origin = req.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = req.get('host');
      if (
        originUrl.host !== host ||
        (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:')
      ) {
        res.status(403).json({ error: 'Invalid Origin' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid Origin' });
      return;
    }
  }

  next();
});

app.get('/api/session', (_req, res) => {
  res.json({ token: sessionToken, project: project.meta.name });
});

interface SearchBody {
  topic?: string;
  limit?: number;
  since?: number;
  until?: number;
  type?: string;
  types?: string[];
  openAccessOnly?: boolean;
  providers?: string[];
  greyLiterature?: boolean;
  checkLinks?: boolean;
  mailto?: string;
  braveApiKey?: string;
  serperApiKey?: string;
  searxngUrl?: string;
  searchFallbackEnabled?: boolean;
  searchFallbackOrder?: string;
}

async function savePayloads(
  db: Parameters<typeof savePayload>[0],
  root: string,
  runId: string,
  payloads: RetrievalPayload[],
): Promise<Array<{ provider: string; reason: string; message: string }>> {
  const failures: Array<{
    provider: string;
    reason: string;
    message: string;
  }> = [];
  for (const payload of payloads) {
    try {
      await savePayload(db, root, runId, payload);
    } catch (error) {
      failures.push({
        provider: payload.provider,
        reason: 'unknown',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

function optionalYear(value: unknown): number | undefined {
  const year = Number(value);
  return Number.isFinite(year) && year > 0 ? Math.trunc(year) : undefined;
}

app.post('/api/search', async (req, res) => {
  const body = req.body as SearchBody;
  const topic = body.topic?.trim();
  if (!topic) {
    res.status(400).json({ error: 'topic is required' });
    return;
  }

  const providers = Array.isArray(body.providers) && body.providers.length
    ? body.providers.map((provider) => String(provider).toLowerCase())
    : ['openalex', 'crossref'];
  if (body.greyLiterature && !providers.includes('web')) providers.push('web');

  const braveApiKey =
    body.braveApiKey?.trim() || process.env.BRAVE_API_KEY || undefined;
  const serperApiKey =
    body.serperApiKey?.trim() || process.env.SERPER_API_KEY || undefined;
  const searxngUrl =
    body.searxngUrl?.trim() || process.env.SEARXNG_URL || undefined;
  const searchFallbackEnabled =
    typeof body.searchFallbackEnabled === 'boolean'
      ? body.searchFallbackEnabled
      : process.env.SEARCH_FALLBACK_ENABLED !== '0';
  const searchFallbackOrder =
    body.searchFallbackOrder?.trim() || process.env.SEARCH_FALLBACK_ORDER;
  const limit = Math.min(
    Math.max(Math.trunc(Number(body.limit ?? 40)) || 40, 1),
    100,
  );
  const since = optionalYear(body.since);
  const until = optionalYear(body.until);
  const types = Array.isArray(body.types)
    ? body.types.filter((type): type is string => typeof type === 'string')
    : undefined;
  const mailto = body.mailto?.trim() || process.env.WINNOW_MAILTO;
  const webConfigured = Boolean(braveApiKey || serperApiKey || searxngUrl);

  try {
    const result = await searchLiterature(topic, {
      limit,
      since,
      until,
      type: body.type,
      types,
      openAccessOnly: body.openAccessOnly === true,
      providers,
      mailto,
      openAlexApiKey: process.env.OPENALEX_API_KEY,
      checkLinks: body.checkLinks === true,
      braveApiKey,
      serperApiKey,
      searxngUrl,
      searchFallbackEnabled,
      searchFallbackOrder,
    });

    createRun(project.db, {
      id: result.runId,
      query: result.query,
      config: {
        limit,
        since: since ?? null,
        until: until ?? null,
        type: body.type ?? null,
        types: types ?? null,
        openAccessOnly: body.openAccessOnly === true,
        providers: providers.join(','),
        greyLiterature: providers.includes('web'),
        webConfigured,
        searchFallbackEnabled,
        searchFallbackOrder: searchFallbackOrder ?? null,
        checkLinks: body.checkLinks === true,
        mailto: mailto ?? null,
        openAlexKeyConfigured: Boolean(process.env.OPENALEX_API_KEY),
      },
    });

    const payloadFailures = await savePayloads(
      project.db,
      project.root,
      result.runId,
      result.payloads,
    );
    saveRunSources(project.db, result.runId, result.query, result.sources);
    const snapshot = snapshotForRankedSources(
      result.runId,
      result.query,
      result.sources,
    );
    const failed = result.failures.length > 0 || payloadFailures.length > 0;
    finishRun(project.db, result.runId, {
      outputSha256: hashSnapshot(snapshot),
      stages: {
        retrieve: failed ? 'partial' : 'ok',
        verify: 'ok',
        rank: 'ok',
      },
      componentHealth: {
        failed,
        failures: [...result.failures, ...payloadFailures],
      },
    });
    recordAuditEvent(project.db, {
      runId: result.runId,
      actor: 'user',
      action: 'search',
      payload: {
        selected: result.selectedCount,
        citable: result.citableCount,
        greyLiterature: providers.includes('web'),
        webConfigured,
        failures: result.failures,
        payloadFailures: payloadFailures.length,
      },
    });

    res.json({
      runId: result.runId,
      selectedCount: result.selectedCount,
      citableCount: result.citableCount,
      failures: result.failures,
      payloadFailures,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'search failed',
    });
  }
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
      variantOf: item.source.variantOf ?? null,
      isVersionOfRecord: item.source.isVersionOfRecord ?? true,
      alternateDois: item.source.alternateDois ?? [],
      // loadRunSources normalises the stored provider to "stored"; website
      // sources from the grey-literature provider are re-labelled here.
      sourceProvider:
        item.source.type === 'website'
          ? 'web'
          : item.source.sourceProvider ?? null,
      type: item.source.type ?? null,
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

app.post('/api/evidence', (req, res) => {
  const {
    runId,
    sourceId,
    field,
    value,
    quote,
    location,
    reviewer,
  } = req.body as {
    runId?: string;
    sourceId?: string;
    field?: string;
    value?: string;
    quote?: string;
    location?: string;
    reviewer?: string;
  };

  if (!runId || !sourceId || !field?.trim() || !value?.trim()) {
    res.status(400).json({
      error: 'runId, sourceId, field and value are required',
    });
    return;
  }

  const screening = loadScreeningState(project.db, runId);
  const item = screening.sources.find(
    (source) => source.source.id === sourceId,
  );
  if (!item || item.decision !== 'include') {
    res.status(400).json({
      error: 'source is not a human-confirmed include in this run',
    });
    return;
  }

  recordExtractionValue(project.db, {
    runId,
    sourceId,
    field: field.trim(),
    value: value.trim(),
    quote: quote?.trim() || undefined,
    location: location?.trim() || undefined,
    reviewer: reviewer?.trim() || 'web',
  });

  res.json({ ok: true });
});

app.post('/api/review', async (req, res) => {
  const body = req.body as {
    runId?: string;
    fields?: unknown;
    style?: string;
    writer?: string;
    model?: string;
    baseUrl?: string;
    support?: boolean;
    supportModel?: string;
    csl?: string;
    consent?: boolean;
  };
  if (!body.runId) {
    res.status(400).json({ error: 'runId is required' });
    return;
  }
  const run = getRun(project.db, body.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }

  const fieldList =
    Array.isArray(body.fields) && body.fields.length
      ? body.fields.filter(
          (item): item is string =>
            typeof item === 'string' && Boolean(item.trim()),
        )
      : DEFAULT_FIELDS;
  const writer = body.writer === 'model' ? 'model' : 'template';
  const modelName = body.model?.trim();
  const baseUrl = body.baseUrl?.trim() || 'http://localhost:11434/v1';
  const apiKey =
    process.env.WINNOW_MODEL_API_KEY ?? process.env.OPENAI_API_KEY;
  const supportModel = body.supportModel?.trim() || modelName;

  if (writer === 'model' && !modelName) {
    res.status(400).json({ error: 'model is required for the model writer' });
    return;
  }
  if (body.support && !supportModel) {
    res.status(400).json({ error: 'support requires a model' });
    return;
  }

  if (writer === 'model' || body.support) {
    const baseUrlError = validateModelBaseUrl(baseUrl);
    if (baseUrlError) {
      res.status(400).json({ error: baseUrlError });
      return;
    }
    if (!isLocalBaseUrl(baseUrl) && body.consent !== true) {
      res.status(400).json({
        error: 'Remote model endpoints require explicit consent',
      });
      return;
    }
  }

  let styleName: string;
  let styleXml: string | undefined;
  try {
    if (body.csl?.trim()) {
      const xml = body.csl.trim();
      if (xml.length > 1_000_000) {
        res.status(400).json({ error: 'CSL file is too large' });
        return;
      }
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
        res.status(400).json({
          error: 'CSL files with DTDs or entities are not allowed',
        });
        return;
      }
      styleXml = xml;
      styleName = `custom-${shortHash(styleXml).slice(0, 8)}`;
      registerCslStyle(styleName, styleXml);
    } else {
      styleName = normaliseStyle(body.style ?? 'apa');
    }
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const bundle = buildEvidenceBundle(project.db, body.runId, fieldList);
    if (!bundle.claims.length) {
      res.status(409).json({
        error: 'No confirmed evidence with quotes. Run extraction first.',
      });
      return;
    }

    const raw =
      writer === 'model'
        ? await generateModelDraft(bundle, {
            baseUrl,
            model: modelName!,
            ...(apiKey ? { apiKey } : {}),
            mode: 'review',
          })
        : generateTemplateDraft(bundle);
    let checked = checkDraft(bundle, raw);

    if (body.support) {
      const outcome = await applySupportCheck(checked, bundle, {
        baseUrl,
        model: supportModel!,
        ...(apiKey ? { apiKey } : {}),
      });
      checked = outcome.draft;
    }

    checked.fields = fieldList;
    checked.citationStyle = styleName;
    checked.citationStyleXml = styleXml;
    const markdown = renderDraftMarkdown(bundle, checked, styleName);
    const row = saveDraft(project.db, {
      runId: body.runId,
      mode: checked.mode,
      writer: checked.writer,
      model: writer === 'model' ? modelName : undefined,
      markdown,
      structured: checked,
      bundle,
      basis: checked.basis,
    });
    res.json({
      draftId: row.id,
      kept: checked.sentences.filter((item) => item.status === 'kept').length,
      marked: checked.sentences.filter(
        (item) => item.status === 'kept_marked',
      ).length,
      held: checked.sentences.filter((item) => item.status === 'held').length,
      dropped: checked.sentences.filter((item) => item.status === 'dropped')
        .length,
      ...(isLocalBaseUrl(baseUrl) || writer === 'template'
        ? {}
        : { warning: `Evidence bundle sent to ${hostOf(baseUrl)}` }),
    });
  } catch (error) {
    if (error instanceof CitationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof ModelError) {
      res.status(502).json({ error: error.message });
      return;
    }
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
    res.status(500).json({ error: 'Internal server error' });
  },
);

const server = app.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort =
    typeof address === 'object' && address ? address.port : port;
  console.log(`Winnow web UI: http://127.0.0.1:${actualPort}`);
  console.log(`Project: ${project.root}`);
  if (process.env.WINNOW_READY_JSON === '1') {
    console.log(`WINNOW_READY ${JSON.stringify({ port: actualPort })}`);
  }
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

function validateModelBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Invalid model base URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Model base URL must use http or https';
  }
  if (url.username || url.password) {
    return 'Model base URL must not contain credentials';
  }
  return null;
}

function isLocalBaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
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
