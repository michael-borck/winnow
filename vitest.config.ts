import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/._*'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
