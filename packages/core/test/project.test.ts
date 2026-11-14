import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findProject,
  initProject,
  openProject,
  projectPaths,
} from '../src/project/project.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'winnow-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('project lifecycle', () => {
  it('creates the project folders, metadata and schema', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);

    expect(project.meta.schemaVersion).toBe(7);
    expect(project.root).toBe(path.join(parent, 'demo'));

    const tables = project.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain('runs');
    expect(tables).toContain('sources');
    expect(tables).toContain('verifications');
    expect(tables).toContain('raw_payloads');
    expect(tables).toContain('run_sources');
    expect(tables).toContain('screening');
    expect(tables).toContain('screening_suggestions');
    expect(tables).toContain('extraction');
    expect(tables).toContain('extraction_suggestions');
    expect(tables).toContain('drafts');
    expect(tables).toContain('stances');
    expect(tables).toContain('stance_suggestions');

    const version = project.db
      .prepare('SELECT version FROM schema_version')
      .get() as { version: number };
    expect(version.version).toBe(7);

    project.db.close();
    await expect(initProject('demo', parent)).rejects.toThrow('already exists');
  });

  it('finds a project from a nested directory and reopens it', async () => {
    const parent = await temporaryDirectory();
    const project = await initProject('demo', parent);
    project.db.close();

    const nested = path.join(project.root, 'briefs');
    expect(await findProject(nested)).toBe(project.root);

    const reopened = await openProject(project.root);
    expect(reopened.meta.name).toBe('demo');
    expect(projectPaths(reopened.root).db).toBe(
      path.join(project.root, '.winnow', 'project.sqlite'),
    );
    reopened.db.close();
  });

  it('rejects names that could escape the parent directory', async () => {
    const parent = await temporaryDirectory();
    await expect(initProject('../escape', parent)).rejects.toThrow(
      'may contain letters',
    );
  });
});
