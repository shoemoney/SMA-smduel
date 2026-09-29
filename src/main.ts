import { boot, currentSessionSeed } from '@/app';
import { createLoadingScreen } from '@/ui/loading-screen';

function start(): void {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('main: #app root element not found in index.html');
  }

  // The splash element is already in index.html so it painted before this
  // module ran. Here we only take ownership of it and start reporting real
  // progress. `createLoadingScreen` is tolerant of a missing element, so this
  // is also safe in the test DOM, which has no splash.
  const loading = createLoadingScreen();

  void boot(root, { loading }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Dismiss BEFORE the crash banner: the splash would otherwise sit on top
    // of the error, whose whole job is to be the first thing readable when
    // something goes wrong during boot.
    loading.dismiss();
    root.innerHTML = '';
    const banner = document.createElement('pre');
    banner.style.cssText = 'padding:24px;color:#ff6b6b;background:#10151c;white-space:pre-wrap;font-family:monospace;';
    // Include the session seed (if one was ever resolved) so a crash report
    // still names the exact run to reproduce, even when the arena screen
    // never got far enough to show its own status line.
    const seed = currentSessionSeed();
    const seedLine = seed !== null ? `\nSeed: ${seed}` : '';
    banner.textContent = `smduel failed to boot:\n${message}${seedLine}`;
    root.appendChild(banner);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
