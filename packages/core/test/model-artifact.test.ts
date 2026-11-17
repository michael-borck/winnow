import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/project/project.js';
import {
  createRun,
  getModelArtifact,
  getRun,
  recordModelArtifact,
  setRunModel,
} from '../src/project/db.js';
import { verifyModelArtifact } from '../src/model/artifact.js';
import type { ModelArtifact } from '../src/types.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const artifactBase = {
  name: 'qwen3:8b',
  endpoint: 'http://localhost:11434/v1',
  verifiedAt: '2026-11-16T00:00:00.000Z',
};

describe('verifyModelArtifact', () => {
  it('reads an Ollama digest and quantization', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return response({
          models: [
            {
              name: 'qwen3:8b',
              model: 'qwen3:8b',
              digest: 'sha256:abc',
              size: 123,
              modified_at: '2026-11-15T00:00:00.000Z',
              details: { quantization_level: 'Q4_K_M' },
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    };

    const artifact = await verifyModelArtifact({
      baseUrl: artifactBase.endpoint,
      model: 'qwen3:8b',
      fetchImpl,
    });

    expect(artifact.verified).toBe(true);
    expect(artifact.digest).toBe('sha256:abc');
    expect(artifact.quantization).toBe('Q4_K_M');
    expect(artifact.source).toBe('ollama');
  });

  it('falls back to the OpenAI model list', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/tags')) return new Response('', { status: 404 });
      if (url.endsWith('/models')) {
        return response({ data: [{ id: 'qwen3:8b' }] });
      }
      throw new Error(`unexpected ${url}`);
    };

    const artifact = await verifyModelArtifact({
      baseUrl: artifactBase.endpoint,
      model: 'qwen3:8b',
      fetchImpl,
    });

    expect(artifact.verified).toBe(false);
    expect(artifact.source).toBe('openai-compatible');
    expect(artifact.error).toBeUndefined();
  });

  it('reports an unknown model', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/tags')) return response({ models: [] });
      if (url.endsWith('/models')) {
        return response({ data: [{ id: 'other' }] });
      }
      throw new Error(`unexpected ${url}`);
    };

    const artifact = await verifyModelArtifact({
      baseUrl: artifactBase.endpoint,
      model: 'qwen3:8b',
      fetchImpl,
    });

    expect(artifact.verified).toBe(false);
    expect(artifact.error).toContain('not found');
  });

  it('reports an unreachable endpoint', async () => {
    const artifact = await verifyModelArtifact({
      baseUrl: artifactBase.endpoint,
      model: 'qwen3:8b',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(artifact.verified).toBe(false);
    expect(artifact.error).toContain('could not inspect');
  });
});

describe('model artifact storage', () => {
  it('stores artifacts, reports digest changes, and updates the run', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'winnow-artifact-'));
    try {
      const project = await initProject('demo', parent);
      const db = project.db;
      const artifact: ModelArtifact = {
        ...artifactBase,
        digest: 'sha256:old',
        quantization: 'Q4_K_M',
        source: 'ollama',
        revision: '2026-11-15',
        size: 123,
        verified: true,
        details: { quantization_level: 'Q4_K_M' },
      };

      recordModelArtifact(db, artifact);
      expect(getModelArtifact(db, 'qwen3:8b')?.digest).toBe('sha256:old');

      const change = recordModelArtifact(db, {
        ...artifact,
        digest: 'sha256:new',
      });
      expect(change.changed).toBe(true);
      expect(change.previousDigest).toBe('sha256:old');
      expect(getModelArtifact(db, 'qwen3:8b')?.digest).toBe('sha256:new');

      createRun(db, { id: 'run-1', query: 'testing', config: {} });
      setRunModel(db, 'run-1', {
        name: 'qwen3:8b',
        digest: 'sha256:new',
      });
      const run = getRun(db, 'run-1');
      expect(run?.model_name).toBe('qwen3:8b');
      expect(run?.model_digest).toBe('sha256:new');

      db.close();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});