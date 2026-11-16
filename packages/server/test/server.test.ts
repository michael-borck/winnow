import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../../core/src/project/project.js';
import { createRun, finishRun } from '../../core/src/project/db.js';

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const temporaryDirectories: string[] = [];

let child: ChildProcess | undefined;
let base = '';
let token = '';
let runId = '';

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-server-'));
  temporaryDirectories.push(directory);
  return directory;
}

function startServer(projectRoot: string): Promise<number> {
  const processHandle = spawn(
    process.execPath,
    [serverPath, `--project=${projectRoot}`],
    {
      env: {
        ...process.env,
        WINNOW_PORT: '0',
        WINNOW_READY_JSON: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child = processHandle;

  return new Promise<number>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start: ${stderr}`));
    }, 10_000);

    processHandle.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/WINNOW_READY (\{.*\})/);
      if (!match) return;
      clearTimeout(timer);
      try {
        const ready = JSON.parse(match[1]!) as { port: number };
        resolve(ready.port);
      } catch (error) {
        reject(error);
      }
    });

    processHandle.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    processHandle.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code}: ${stderr}`));
    });
  });
}

async function stopServer(): Promise<void> {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const handle = child!;
    const timer = setTimeout(() => {
      handle.kill('SIGKILL');
      resolve();
    }, 3_000);
    handle.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    handle.kill('SIGTERM');
  });
}

beforeAll(async () => {
  const parent = await temporaryDirectory();
  const project = await initProject('demo', parent);
  runId = 'run-server-test';
  createRun(project.db, { id: runId, query: 'testing', config: {} });
  finishRun(project.db, runId, {
    outputSha256: 'test',
    stages: { retrieve: 'ok' },
    componentHealth: { failed: false },
  });
  project.db.close();

  const port = await startServer(project.root);
  base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/session`);
  const session = (await response.json()) as { token: string };
  token = session.token;
});

afterAll(async () => {
  await stopServer();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('server trust boundary', () => {
  it('requires a token for state reads', async () => {
    const response = await fetch(`${base}/api/state`);
    expect(response.status).toBe(403);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves state with a token and no-store caching', async () => {
    const response = await fetch(`${base}/api/state`, {
      headers: { 'x-winnow-token': token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a cross-origin state change', async () => {
    const response = await fetch(`${base}/api/screen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ runId, sourceId: 'x', decision: 'include' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows a same-origin state change to reach validation', async () => {
    const response = await fetch(`${base}/api/screen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
        origin: base,
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('requires consent for a remote model endpoint', async () => {
    const response = await fetch(`${base}/api/review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
      },
      body: JSON.stringify({
        runId,
        writer: 'model',
        model: 'qwen3:8b',
        baseUrl: 'https://llm.example.com/v1',
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('consent');
  });

  it('accepts a remote model endpoint with consent and reaches the evidence check', async () => {
    const response = await fetch(`${base}/api/review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
      },
      body: JSON.stringify({
        runId,
        writer: 'model',
        model: 'qwen3:8b',
        baseUrl: 'https://llm.example.com/v1',
        consent: true,
      }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects non-http model URLs', async () => {
    const response = await fetch(`${base}/api/review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
      },
      body: JSON.stringify({
        runId,
        writer: 'model',
        model: 'qwen3:8b',
        baseUrl: 'file:///etc/passwd',
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('http or https');
  });

  it('rejects CSL files with DTDs or entities', async () => {
    const response = await fetch(`${base}/api/review`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-winnow-token': token,
      },
      body: JSON.stringify({
        runId,
        writer: 'template',
        csl: '<!DOCTYPE style [<!ENTITY x "y">]>',
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('DTDs');
  });
});