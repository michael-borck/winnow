import { openProject } from './project/project.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  durationMs?: number;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  hosts: string[];
}

export type DoctorFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DoctorOptions {
  projectRoot?: string;
  baseUrl?: string;
  model?: string;
  mailto?: string;
  offline?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: DoctorFetch;
  nodeVersion?: string;
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl?.trim() || 'http://localhost:11434/v1';
  const offline = options.offline === true;
  const fetchImpl: DoctorFetch =
    options.fetchImpl ?? ((url, init) => fetch(url, init));

  const semanticScholarKey = env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  const project = await checkProject(options.projectRoot);
  const providers = await Promise.all([
    checkProvider(
      'provider:openalex',
      withMailto(
        'https://api.openalex.org/works?per-page=1&select=id',
        options.mailto,
      ),
      {},
      fetchImpl,
      offline,
    ),
    checkProvider(
      'provider:crossref',
      withMailto('https://api.crossref.org/works?rows=0', options.mailto),
      {},
      fetchImpl,
      offline,
    ),
    checkProvider(
      'provider:semantic_scholar',
      withMailto(
        'https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-020-2649-2?fields=title',
        options.mailto,
      ),
      semanticScholarKey ? { 'x-api-key': semanticScholarKey } : {},
      fetchImpl,
      offline,
    ),
  ]);

  const checks: DoctorCheck[] = [
    checkNode(options.nodeVersion ?? process.versions.node),
    project,
    networkCheck(providers, offline),
    ...providers,
    await checkModel({
      baseUrl,
      model: options.model,
      env,
      fetchImpl,
      offline,
    }),
    checkKeys(env, baseUrl),
  ];

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    checks,
    hosts: hostsFor(baseUrl, offline),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Winnow doctor'];
  for (const check of report.checks) {
    const duration =
      check.durationMs == null ? '' : ` (${check.durationMs}ms)`;
    lines.push(`  [${check.status}] ${check.name}: ${check.detail}${duration}`);
  }

  lines.push('', 'Hosts Winnow may contact:');
  if (report.hosts.length) {
    for (const host of report.hosts) lines.push(`  ${host}`);
    lines.push(
      '  Landing-page probes contact publisher hosts only with --check-links.',
    );
  } else {
    lines.push('  none (offline mode)');
  }

  lines.push('', report.ok ? 'All required checks passed.' : 'Some checks failed.');
  return `${lines.join('\n')}\n`;
}

function checkNode(version: string): DoctorCheck {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isFinite(major) && major >= 24) {
    return { name: 'node', status: 'ok', detail: `v${version}` };
  }
  return {
    name: 'node',
    status: 'fail',
    detail: `v${version} (requires Node 24 or newer)`,
  };
}

async function checkProject(root: string | undefined): Promise<DoctorCheck> {
  if (!root) {
    return {
      name: 'project',
      status: 'warn',
      detail: 'no project found; search runs ephemerally',
    };
  }

  let project;
  try {
    project = await openProject(root);
  } catch (error) {
    return { name: 'project', status: 'fail', detail: messageOf(error) };
  }

  try {
    const rows = project.db.prepare('PRAGMA quick_check').all() as Array<
      Record<string, unknown>
    >;
    const values = rows
      .flatMap((row) => Object.values(row))
      .map((value) => String(value));
    const healthy =
      values.length > 0 &&
      values.every((value) => value.toLowerCase() === 'ok');
    return {
      name: 'project',
      status: healthy ? 'ok' : 'fail',
      detail: `${root} (schema ${project.meta.schemaVersion}, quick_check ${
        healthy ? 'ok' : values.join(', ')
      })`,
    };
  } catch (error) {
    return {
      name: 'project',
      status: 'fail',
      detail: `cannot check ${root}: ${messageOf(error)}`,
    };
  } finally {
    project.db.close();
  }
}

async function checkProvider(
  name: string,
  url: string,
  headers: Record<string, string>,
  fetchImpl: DoctorFetch,
  offline: boolean,
): Promise<DoctorCheck> {
  if (offline) {
    return { name, status: 'skipped', detail: 'offline mode' };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(8_000),
    });
    const durationMs = Date.now() - startedAt;
    if (response.ok) {
      return { name, status: 'ok', detail: `HTTP ${response.status}`, durationMs };
    }
    return {
      name,
      status: response.status === 429 ? 'warn' : 'fail',
      detail: `HTTP ${response.status}`,
      durationMs,
    };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: messageOf(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function checkModel(options: {
  baseUrl: string;
  model?: string;
  env: Record<string, string | undefined>;
  fetchImpl: DoctorFetch;
  offline: boolean;
}): Promise<DoctorCheck> {
  const name = 'model';
  if (options.offline) {
    return { name, status: 'skipped', detail: 'offline mode' };
  }

  const apiKey =
    (options.env.WINNOW_MODEL_API_KEY ?? options.env.OPENAI_API_KEY)?.trim() ||
    undefined;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/models`;
  const startedAt = Date.now();

  try {
    const response = await options.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(5_000),
    });
    const durationMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        name,
        status: 'fail',
        detail: `authentication failed (HTTP ${response.status})`,
        durationMs,
      };
    }
    if (!response.ok) {
      return {
        name,
        status: 'warn',
        detail: `HTTP ${response.status} at ${url}`,
        durationMs,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        name,
        status: 'warn',
        detail: `HTTP ${response.status} but the body was not JSON`,
        durationMs,
      };
    }

    const models = modelIds(body);
    if (!models.length) {
      return {
        name,
        status: 'warn',
        detail: 'endpoint reachable but returned no model list',
        durationMs,
      };
    }
    if (options.model && !models.includes(options.model)) {
      return {
        name,
        status: 'warn',
        detail: `model ${options.model} not listed; ${models.length} available`,
        durationMs,
      };
    }
    return {
      name,
      status: 'ok',
      detail: `${models.length} model(s) available${
        options.model ? `; ${options.model} found` : ''
      }`,
      durationMs,
    };
  } catch (error) {
    const local = isLocalBaseUrl(options.baseUrl);
    return {
      name,
      status: 'warn',
      detail: `${local ? 'local model not reachable' : 'model endpoint not reachable'}: ${messageOf(error)}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

function checkKeys(
  env: Record<string, string | undefined>,
  baseUrl: string,
): DoctorCheck {
  const modelKey =
    (env.WINNOW_MODEL_API_KEY ?? env.OPENAI_API_KEY)?.trim() || undefined;
  const semanticScholarKey = env.SEMANTIC_SCHOLAR_API_KEY?.trim() || undefined;
  const detail =
    `model: ${modelKey ? 'set' : 'not set'}; ` +
    `Semantic Scholar: ${semanticScholarKey ? 'set' : 'not set'}`;

  if (!isLocalBaseUrl(baseUrl) && !modelKey) {
    return {
      name: 'keys',
      status: 'warn',
      detail: `${detail}; remote model endpoint has no key`,
    };
  }
  return { name: 'keys', status: 'ok', detail };
}

function networkCheck(
  providers: DoctorCheck[],
  offline: boolean,
): DoctorCheck {
  if (offline) {
    return { name: 'network', status: 'skipped', detail: 'offline mode' };
  }

  const failed = providers.filter((check) => check.status === 'fail').length;
  const warned = providers.filter((check) => check.status === 'warn').length;
  if (failed) {
    return {
      name: 'network',
      status: 'fail',
      detail: `${failed} provider(s) unreachable`,
    };
  }
  if (warned) {
    return {
      name: 'network',
      status: 'warn',
      detail: `${warned} provider(s) rate limited or degraded`,
    };
  }
  return { name: 'network', status: 'ok', detail: 'provider APIs reachable' };
}

function hostsFor(baseUrl: string, offline: boolean): string[] {
  if (offline) return [];
  const hosts = new Set([
    'api.openalex.org',
    'api.crossref.org',
    'api.semanticscholar.org',
  ]);
  try {
    hosts.add(new URL(baseUrl).host);
  } catch {
    // The model endpoint is reported by the model check.
  }
  return [...hosts];
}

function withMailto(url: string, mailto: string | undefined): string {
  if (!mailto?.trim()) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('mailto', mailto.trim());
  return parsed.toString();
}

function modelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as { data?: unknown; models?: unknown };
  const values = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];

  return values
    .map((value) => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return undefined;
      const item = value as { id?: unknown; name?: unknown };
      if (typeof item.id === 'string') return item.id;
      if (typeof item.name === 'string') return item.name;
      return undefined;
    })
    .filter((value): value is string => Boolean(value));
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
