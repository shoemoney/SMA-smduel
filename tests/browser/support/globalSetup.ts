/**
 * Vitest `globalSetup` for the real-Chrome suite (`npm run test:browser`,
 * `SMDUEL_TEST_BROWSER=1` in `vite.config.ts`'s own `test.globalSetup`): runs
 * once for the whole browser test-file run, not once per file, so a `vite
 * build` + a preview server aren't paid for twice just because there are two
 * test files.
 *
 * Builds the real production bundle once and serves it with Vite's own
 * `preview` server (not a hand-rolled static server) on an OS-assigned free
 * port, so every browser test loads the exact `dist/` a real deploy would
 * serve — same `base: './'`, same asset paths. The resolved URL is handed to
 * test files via `process.env.SMDUEL_TEST_BASE_URL`: Vitest's globalSetup
 * runs before test files are loaded and env vars it sets are inherited by
 * them, which is the whole point of doing the build here instead of in each
 * file's own `beforeAll`.
 *
 * Each test file launches and closes its OWN Chrome (`chromium.launch`), so
 * this file only owns the preview server's lifecycle — the returned teardown
 * closes exactly that, and nothing here can leak a browser process.
 */
import { build, preview, type PreviewServer } from 'vite';

export default async function setup(): Promise<() => Promise<void>> {
  await build({ logLevel: 'warn' });

  const server: PreviewServer = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
  const baseUrl = server.resolvedUrls?.local[0];
  if (baseUrl === undefined) {
    await new Promise<void>((resolve, reject) => server.httpServer.close((err) => (err ? reject(err) : resolve())));
    throw new Error('test:browser globalSetup: vite preview did not resolve a local URL');
  }

  process.env.SMDUEL_TEST_BASE_URL = baseUrl;

  return async () => {
    await new Promise<void>((resolve, reject) => server.httpServer.close((err) => (err ? reject(err) : resolve())));
  };
}
