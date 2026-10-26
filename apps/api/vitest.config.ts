import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/scripts/**', 'src/server.ts', 'src/db/migrate.ts'],
      // DEAR-11 acceptance: money-moving modules stay at or above 80%.
      thresholds: {
        'src/modules/transactions/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/modules/payments/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/modules/sync/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
