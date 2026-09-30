// @vitest-environment happy-dom
/**
 * The loading splash and its Autoduel tribute card.
 *
 * This is a test about TIMING and about a promise made to the player, and both
 * of the bugs it guards were invisible to a green suite:
 *
 * - `dismiss()` called `handOverToLoading()` "so the wait could never expire on
 *   a card still covering the chrome". That call fired the handover the moment
 *   boot finished — around 500ms on a warm cache — which cancelled the 2600ms
 *   hold entirely. Every test that only asked "does the splash eventually go
 *   away" still passed; the credit was on screen for one frame. A live
 *   `MutationObserver` timeline is what caught it: handover logged at 538ms,
 *   while the card's own entrance animation was still running to 900ms.
 * - The reduced-motion branch handed over IMMEDIATELY, reasoning that a static
 *   card need not be waited for. "No animation" is not "no content": for those
 *   players the credit was gone before it could be read.
 *
 * The splash element lives in `index.html` because it must paint before the
 * module graph loads, so these tests build the same markup the file does rather
 * than importing it — the real file is the thing that has to be right, and a
 * test that re-declared the structure would be testing its own copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoadingScreen } from '@/ui/loading-screen';

/** The splash markup index.html ships, reduced to what this module touches. */
function installSplash(options: { reducedMotion?: boolean } = {}): HTMLElement {
  document.body.innerHTML = `
    <div class="sm-boot" id="sm-boot" role="status" aria-busy="true">
      <div class="sm-boot__tribute">
        <p class="sm-boot__tribute-kicker">Origin Systems &middot; 1985</p>
        <h1 class="sm-boot__tribute-title">Inspired by a Childhood Classic</h1>
        <p class="sm-boot__tribute-line">This game is a modern reimagining of <strong>Autoduel (1985)</strong>.</p>
        <p class="sm-boot__tribute-line">Original game by <strong>Origin Systems</strong>, designed by <strong>Chuckles and Lord British</strong>.</p>
        <div class="sm-boot__tribute-rule"></div>
        <p class="sm-boot__tribute-line">Thank you for the memories.</p>
      </div>
      <div class="sm-boot__bar" id="sm-boot-bar" role="progressbar"><div class="sm-boot__fill" id="sm-boot-fill"></div></div>
      <p class="sm-boot__status" id="sm-boot-status">Warming up</p>
    </div>`;
  const reduce = options.reducedMotion === true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const root = document.getElementById('sm-boot');
  if (root === null) throw new Error('test: splash markup did not install');
  return root;
}

const boot = (): HTMLElement => {
  const el = document.getElementById('sm-boot');
  if (el === null) throw new Error('test: no #sm-boot');
  return el;
};

describe('loading splash — the Autoduel tribute card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('holds the card on its own for the full credit time before handing over', () => {
    const root = installSplash();
    createLoadingScreen();

    // The card is the ONLY thing on screen: no handover class yet.
    expect(root.classList.contains('sm-boot--loading')).toBe(false);

    // Boot finishing early must NOT bring the card forward. This is the exact
    // call that used to cancel the hold.
    createLoadingScreen().dismiss();
    vi.advanceTimersByTime(0);
    expect(root.classList.contains('sm-boot--loading')).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(root.classList.contains('sm-boot--loading')).toBe(false);

    // …and it does eventually hand over on its own timer.
    vi.advanceTimersByTime(1500);
    expect(root.classList.contains('sm-boot--loading')).toBe(true);
  });

  it('still holds the full credit time for a player who asked for reduced motion', () => {
    // "No animation" is not "no content". The card is four lines of credit; a
    // player who cannot abide the slide still has to be able to read it.
    const root = installSplash({ reducedMotion: true });
    createLoadingScreen();
    vi.advanceTimersByTime(0);
    expect(root.classList.contains('sm-boot--loading')).toBe(false);
    vi.advanceTimersByTime(2599);
    expect(root.classList.contains('sm-boot--loading')).toBe(false);
    vi.advanceTimersByTime(2);
    expect(root.classList.contains('sm-boot--loading')).toBe(true);
  });

  it('does not remove the splash until the card has finished leaving', () => {
    // If the splash fades while the card is still on screen, the title screen
    // eats the credit mid-read — which is what happened before the fade floor
    // learned about the handover.
    const root = installSplash();
    const loading = createLoadingScreen();
    loading.report(1);
    loading.dismiss();
    vi.advanceTimersByTime(2600); // handover just applied
    expect(root.isConnected).toBe(true);
    vi.advanceTimersByTime(1000); // handover + exit
    expect(root.isConnected).toBe(true);
    vi.advanceTimersByTime(1000); // past the fade
    expect(root.isConnected).toBe(false);
  });

  it('reports real progress and never invents it', () => {
    installSplash();
    const loading = createLoadingScreen();
    const bar = document.getElementById('sm-boot-bar');
    const status = document.getElementById('sm-boot-status');
    if (bar === null || status === null) throw new Error('test: splash parts missing');

    loading.report(0.3);
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(status.textContent).toBe('Loading rules');

    // A step that goes backwards is a real load finishing out of order, and a
    // bar that visibly rewinds reads as a bug in the game.
    loading.report(0.1);
    expect(bar.getAttribute('aria-valuenow')).toBe('30');

    loading.report(1);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.classList.contains('sm-boot__bar--done')).toBe(true);
    expect(boot().getAttribute('aria-busy')).toBe('false');
  });

  it('is inert when there is no splash at all, as in the test DOM', () => {
    // `main.ts` calls this before it knows whether the splash exists, so a
    // missing element must be a no-op rather than a throw.
    document.body.innerHTML = '';
    const loading = createLoadingScreen();
    expect(() => {
      loading.report(0.5);
      loading.dismiss();
    }).not.toThrow();
    vi.advanceTimersByTime(5000);
  });
});
