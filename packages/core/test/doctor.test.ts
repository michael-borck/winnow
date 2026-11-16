import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  formatDoctorReport,
  runDoctor,
  type DoctorFetch,
  type DoctorReport,
} from '../src/doctor.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-doctor-'));
  temporaryDirectories.push(directory);
  return directory;
}

function response(body: unknown = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(
  handler: (url: string) => Response | Promise<Response>,
): DoctorFetch {
  return async (url) => handler(url);
}

function check(report: DoctorReport, name: string) {
  const found = report.checks.find((item) => item.name === name);
  if (!found) throw new Error(`Missing check: ${name}`);
  return found;
}

function healthyFetch(): DoctorFetch {
  return fakeFetch((url) => {
    if (url.endsWith('/models')) {
      return response({ data: [{ id: 'qwen3:8b' }] });
    }
    return response({ ok: true });
  });
}

describe('runDoctor', () => {
  it('reports healthy providers, model and keys', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      fetchImpl: healthyFetch(),
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
    });

    expect(report.ok).toBe(true);
    expect(check(report, 'node').status).toBe('ok');
    expect(check(report, 'project').status).toBe('warn');
    expect(check(report, 'network').status).toBe('ok');
    expect(check(report, 'provider:openalex').status).toBe('ok');
    expect(check(report, 'provider:crossref').status).toBe('ok');
    expect(check(report, 'provider:semantic_scholar').status).toBe('ok');
    expect(check(report, 'model').status).toBe('ok');
    expect(check(report, 'keys').status).toBe('ok');
    expect(report.hosts).toContain('api.openalex.org');
    expect(report.hosts).toContain('api.crossref.org');
    expect(report.hosts).toContain('api.semanticscholar.org');
    expect(report.hosts).toContain('localhost:11434');
  });

  it('reports provider, network and model failures', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      fetchImpl: fakeFetch((url) => {
        if (url.includes('api.openalex.org')) {
          throw new TypeError('fetch failed');
        }
        if (url.includes('api.crossref.org')) return response({}, 500);
        if (url.includes('api.semanticscholar.org')) return response({}, 429);
        if (url.endsWith('/models')) return response({}, 401);
        return response({});
      }),
      baseUrl: 'https://llm.example.com/v1',
    });

    expect(report.ok).toBe(false);
    expect(check(report, 'provider:openalex').status).toBe('fail');
    expect(check(report, 'provider:crossref').status).toBe('fail');
    expect(check(report, 'provider:semantic_scholar').status).toBe('warn');
    expect(check(report, 'network').status).toBe('fail');
    expect(check(report, 'model').status).toBe('fail');
    expect(check(report, 'keys').status).toBe('warn');
  });

  it('skips network checks in offline mode', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      offline: true,
      fetchImpl: fakeFetch(() => {
        throw new Error('fetch should not run in offline mode');
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.hosts).toEqual([]);
    expect(check(report, 'network').status).toBe('skipped');
    expect(check(report, 'provider:openalex').status).toBe('skipped');
    expect(check(report, 'provider:crossref').status).toBe('skipped');
    expect(check(report, 'provider:semantic_scholar').status).toBe('skipped');
    expect(check(report, 'model').status).toBe('skipped');
  });

  it('checks a project database', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    project.db.close();

    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      offline: true,
      projectRoot: project.root,
    });

    expect(check(report, 'project').status).toBe('ok');
    expect(check(report, 'project').detail).toContain('schema 7');
    expect(check(report, 'project').detail).toContain('quick_check ok');
  });

  it('fails on an old Node version', async () => {
    const report = await runDoctor({
      nodeVersion: '22.0.0',
      env: {},
      offline: true,
    });

    expect(report.ok).toBe(false);
    expect(check(report, 'node').status).toBe('fail');
    expect(check(report, 'node').detail).toContain('Node 24');
  });

  it('warns when the local model is not running', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith('/models')) {
          throw new TypeError('connect ECONNREFUSED');
        }
        return response({});
      }),
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(report.ok).toBe(true);
    expect(check(report, 'model').status).toBe('warn');
    expect(check(report, 'model').detail).toContain('local model not reachable');
  });

  it('warns when a requested model is not listed', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      fetchImpl: fakeFetch((url) => {
        if (url.endsWith('/models')) {
          return response({ data: [{ id: 'other:latest' }] });
        }
        return response({});
      }),
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
    });

    expect(check(report, 'model').status).toBe('warn');
    expect(check(report, 'model').detail).toContain('not listed');
  });
});

describe('formatDoctorReport', () => {
  it('lists hosts and never prints key values', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {
        WINNOW_MODEL_API_KEY: 'super-secret-model-key',
        SEMANTIC_SCHOLAR_API_KEY: 'super-secret-s2-key',
      },
      offline: true,
      baseUrl: 'https://llm.example.com/v1',
    });

    const text = formatDoctorReport(report);
    expect(text).toContain('Winnow doctor');
    expect(text).toContain('none (offline mode)');
    expect(text).toContain('model: set');
    expect(text).toContain('Semantic Scholar: set');
    expect(text).not.toContain('super-secret-model-key');
    expect(text).not.toContain('super-secret-s2-key');
  });

  it('lists the provider and model hosts', async () => {
    const report = await runDoctor({
      nodeVersion: '24.1.0',
      env: {},
      fetchImpl: healthyFetch(),
      baseUrl: 'http://localhost:11434/v1',
    });

    const text = formatDoctorReport(report);
    expect(text).toContain('Hosts Winnow may contact:');
    expect(text).toContain('api.openalex.org');
    expect(text).toContain('localhost:11434');
    expect(text).toContain('--check-links');
  });
});
