import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const resourcesDir = path.join(desktopRoot, 'resources');
const serverDir = path.join(resourcesDir, 'server');

await rm(resourcesDir, { recursive: true, force: true });
await mkdir(path.join(serverDir, 'dist'), { recursive: true });

await writeFile(
  path.join(serverDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'winnow-server-bundle',
      private: true,
      type: 'module',
      dependencies: {
        '@michaelborck/winnow-core': 'file:../../core',
        express: '^5.1.0',
      },
    },
    null,
    2,
  )}\n`,
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await execFileAsync(npm, ['install', '--omit=dev', '--prefix', serverDir], {
  cwd: repoRoot,
  shell: process.platform === 'win32',
  maxBuffer: 10 * 1024 * 1024,
});

await build({
  entryPoints: [path.join(repoRoot, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  outfile: path.join(serverDir, 'dist', 'index.js'),
  logLevel: 'info',
});

await cp(
  path.join(repoRoot, 'packages/web/dist'),
  path.join(resourcesDir, 'web/dist'),
  { recursive: true },
);

async function removeAppleDouble(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeAppleDouble(fullPath);
    } else if (entry.name.startsWith('._')) {
      await unlink(fullPath);
    }
  }
}

await removeAppleDouble(resourcesDir);

process.stdout.write(`Prepared desktop resources in ${resourcesDir}\n`);