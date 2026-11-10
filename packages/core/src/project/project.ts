import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './db.js';

export const SCHEMA_VERSION = 1;

export interface ProjectMeta {
  name: string;
  createdAt: string;
  schemaVersion: number;
  defaultStage: string;
}

export interface OpenProject {
  root: string;
  meta: ProjectMeta;
  db: DatabaseSync;
}

export async function initProject(
  name: string,
  parentPath?: string,
): Promise<OpenProject> {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(
      'Project name may contain letters, numbers, dots, underscores and hyphens only',
    );
  }

  const parent = path.resolve(parentPath ?? process.cwd());
  const root = path.join(parent, name);
  const winnowDir = path.join(root, '.winnow');
  const metaPath = path.join(winnowDir, 'project.json');

  try {
    await stat(metaPath);
    throw new Error(`Project already exists at ${root}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Project already exists')) {
      throw error;
    }
    // Missing metadata is the expected path.
  }

  await mkdir(winnowDir, { recursive: true });
  for (const directory of ['briefs', 'drafts', 'exports', 'payloads']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }

  try {
    await writeFile(
      path.join(root, '.gitignore'),
      '# Winnow local data\n.winnow/project.sqlite\n.winnow/project.sqlite-*\npayloads/\n',
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch {
    // An existing .gitignore is the user's business.
  }

  const meta: ProjectMeta = {
    name,
    createdAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    defaultStage: 'explore',
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const db = new DatabaseSync(path.join(winnowDir, 'project.sqlite'));
  migrate(db);

  return { root, meta, db };
}

export async function findProject(startPath?: string): Promise<string | null> {
  let current = path.resolve(startPath ?? process.cwd());

  while (true) {
    try {
      const info = await stat(path.join(current, '.winnow', 'project.json'));
      if (info.isFile()) return current;
    } catch {
      // Keep walking up.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function openProject(rootPath: string): Promise<OpenProject> {
  const root = path.resolve(rootPath);
  const metaPath = path.join(root, '.winnow', 'project.json');
  let meta: ProjectMeta;

  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as ProjectMeta;
  } catch (error) {
    throw new Error(
      `Not a Winnow project: ${root} (missing .winnow/project.json)`,
      { cause: error },
    );
  }

  if (meta.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Project schema ${meta.schemaVersion} is newer than this Winnow (${SCHEMA_VERSION})`,
    );
  }

  const db = new DatabaseSync(path.join(root, '.winnow', 'project.sqlite'));
  migrate(db);
  return { root, meta, db };
}

export function projectPaths(root: string) {
  return {
    winnow: path.join(root, '.winnow'),
    db: path.join(root, '.winnow', 'project.sqlite'),
    payloads: path.join(root, 'payloads'),
    briefs: path.join(root, 'briefs'),
    drafts: path.join(root, 'drafts'),
    exports: path.join(root, 'exports'),
  };
}
