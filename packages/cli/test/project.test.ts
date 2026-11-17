import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../../core/src/project/project.js';
import { createRun, savePayload } from '../../core/src/project/db.js';
import type { RetrievalPayload } from '../../core/src/types.js';

const cliPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-project-'));
  temporaryDirectories.push(directory);
  return directory;
}

function payload(): RetrievalPayload {
  return {
    id: 'payload-test',
    provider: 'openalex',
    query: 'testing',
    url: 'https://example.test/works',
    fetchedAt: new Date().toISOString(),
    body: '{"ok":true}',
  };
}

async function runCli(args: string[]): Promise<string> {
  const result = await execFileAsync(process.execPath, [cliPath, ...args]);
  return result.stdout;
}

describe('project data commands', () => {
  it('exports a portable archive, purges payloads, and deletes the project', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    createRun(project.db, {
      id: 'run-1',
      query: 'testing',
      config: {},
    });
    await savePayload(project.db, project.root, 'run-1', payload());
    project.db.close();

    const archive = path.join(parent, 'demo.tar.gz');
    const exported = await runCli([
      'project',
      'export',
      project.root,
      '--out',
      archive,
    ]);
    expect(exported).toContain('Exported');

    const archiveInfo = await stat(archive);
    expect(archiveInfo.size).toBeGreaterThan(0);

    const purged = await runCli([
      'cache',
      'purge',
      '--project',
      project.root,
    ]);
    expect(purged).toContain('Purged 1 payload file');

    const payloads = await readdir(path.join(project.root, 'payloads'));
    expect(payloads).toHaveLength(0);

    const deleted = await runCli([
      'project',
      'delete',
      project.root,
      '--purge',
      '--yes',
    ]);
    expect(deleted).toContain('Deleted');
    await expect(stat(project.root)).rejects.toThrow();
  });

  it('refuses an archive inside the project folder', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    project.db.close();

    await expect(
      runCli([
        'project',
        'export',
        project.root,
        '--out',
        path.join(project.root, 'inside.tar.gz'),
      ]),
    ).rejects.toThrow();
  });
});