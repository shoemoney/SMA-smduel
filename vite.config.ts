import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// `npm run test:browser` sets this so the SAME config file can point at the
// real-Chrome suite (tests/browser/**) instead of the default node/happy-dom
// one — see that script and tests/browser/support/globalSetup.ts. Plain
// `npx vitest run` never sets it, so the default suite never launches a
// browser or needs `dist/` built.
const browserSuite = process.env.SMDUEL_TEST_BROWSER === '1';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@rulesets': fileURLToPath(new URL('./rulesets', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: browserSuite ? ['tests/browser/**/*.test.ts'] : ['tests/**/*.test.ts'],
    exclude: browserSuite ? [] : ['tests/browser/**'],
    globals: true,
    ...(browserSuite
      ? {
          globalSetup: ['tests/browser/support/globalSetup.ts'],
          // A real Chrome launch + `vite build`/preview per file is slower
          // than the in-process node/happy-dom suite's default 5s.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        }
      : {}),
  },
});
