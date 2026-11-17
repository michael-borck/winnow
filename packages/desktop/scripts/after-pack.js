const { execFileSync } = require('node:child_process');
const { readdir, rm, unlink } = require('node:fs/promises');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  let removed = 0;

  async function removeAppleDouble(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeAppleDouble(fullPath);
      } else if (entry.name.startsWith('._')) {
        await unlink(fullPath);
        removed += 1;
      }
    }
  }

  async function removeLocales(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.lproj')) {
        await rm(fullPath, { recursive: true, force: true });
      } else {
        await removeLocales(fullPath);
      }
    }
  }

  await removeAppleDouble(appOutDir);
  await removeLocales(appOutDir);

  if (process.platform === 'darwin') {
    try {
      execFileSync('xattr', ['-cr', appOutDir], { stdio: 'inherit' });
    } catch {
      console.log('winnow: xattr not available');
    }
    try {
      execFileSync('dot_clean', [appOutDir], { stdio: 'inherit' });
    } catch {
      console.log('winnow: dot_clean not available; using the file walk only');
    }
  }

  console.log(`winnow: afterPack removed ${removed} AppleDouble file(s)`);
};