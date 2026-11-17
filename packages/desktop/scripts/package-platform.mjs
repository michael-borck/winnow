import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.env.PLATFORM;
if (!platform) {
  throw new Error('PLATFORM is required (mac, win or linux)');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');

execFileSync(
  'npx',
  [
    'electron-builder',
    '--config',
    'electron-builder.config.js',
    `--${platform}`,
    '--publish',
    'always',
  ],
  {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);