import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(
  new URL('../src/main.ts', import.meta.url),
);

describe('Electron shell security posture', () => {
  it('keeps the renderer sandboxed and isolated', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('contextIsolation: true');
    expect(source).toContain('sandbox: true');
    expect(source).toContain('nodeIntegration: false');
  });

  it('loads only the localhost server', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('http://127.0.0.1:${port}/');
    expect(source).toContain('shell.openExternal(url)');
    expect(source).toContain("return { action: 'deny' }");
  });
});