import { boot, currentSessionSeed } from '@/app';

function start(): void {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('main: #app root element not found in index.html');
  }
  void boot(root).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
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
