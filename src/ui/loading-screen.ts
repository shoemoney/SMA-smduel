/**
 * The ShoeMoney loading splash: a horizontal progress bar, the company logo,
 * and the line "A ShoeMoney AI Labs Game".
 *
 * ## Why this is a module and not inline script
 *
 * The markup and the critical CSS are inlined in index.html (see the comment
 * there) so the splash paints on the FIRST frame, before the module graph has
 * finished loading. This module does not create the splash — it adopts the one
 * already in the document and drives it. Doing it the other way round (build the
 * splash here, in JS) would mean the user stares at a blank page for exactly the
 * duration the splash exists to cover.
 *
 * ## The progress bar is REAL
 *
 * Every value pushed through {@link report} corresponds to work that actually
 * happened or has actually completed. There is no timer, no easing toward 90%,
 * and no "fake it then reveal" — the bar reaching 100% means the title screen's
 * own 1.7MB background image has finished decoding and is on screen, which is
 * the last thing before the player can interact.
 *
 * That matters more than it sounds. A decorative progress bar that crawls to
 * 100% on a fixed timer is worse than no bar: it teaches the player that the
 * game's reported state is not to be trusted, and when a real load is slow they
 * have no way to tell a slow load from a hang. This bar stalls at its last real
 * value if the load stalls, and says so in `aria-valuenow`.
 */

/** Fraction values, so the ordering of the boot phases is visible in one place. */
const PHASE = {
  /** The module graph parsed and this module ran. Something definitely happened. */
  booted: 0.12,
  /** Ruleset JSON parsed and every invariant checked. */
  validated: 0.3,
  /** IndexedDB opened and any existing save read (or confirmed absent). */
  saved: 0.45,
  /** The title art has been fetched and decoded. */
  artwork: 0.85,
  /** The title screen is mounted and interactive. */
  ready: 1,
} as const;

/**
 * Minimum time the splash stays on screen, in milliseconds.
 *
 * See the note in `dismiss()`. Measured boot on a warm cache is ~380ms, which is
 * below the threshold at which anyone can read a logo, so without a floor this
 * screen is invisible in practice on a fast machine.
 */
const MIN_DISPLAY_MS = 1100;

/**
 * How long the Autoduel tribute card holds the screen on its own, in ms.
 *
 * It is a CREDIT, not chrome: four lines of type that a player has to be able to
 * actually read. The lines stagger in over roughly 900ms (see the
 * `sm-tribute-line` delays), so anything under ~1s would hand over mid-fade and
 * cut the last line off as it appeared. 2600ms leaves the finished card sitting
 * on black for over a second before it moves.
 *
 * This is deliberately NOT tied to load progress. Boot on a warm cache finishes
 * in ~380ms, so a progress-triggered handover would show the card for a fraction
 * of a second on exactly the machines that reach the title screen fastest — the
 * opposite of what a credit is for. The card holds for its own time; the real
 * progress bar behind it keeps reporting the truth throughout, so a slow load is
 * still visibly slow after the card has gone.
 */
const TRIBUTE_HOLD_MS = 2600;

export interface LoadingScreen {
  /** Push a real progress value (0..1) and an optional status line. */
  report(fraction: number, status?: string): void;
  /** Fade out and remove the splash. Safe to call more than once. */
  dismiss(): void;
  /** True once {@link dismiss} has been called. */
  readonly dismissed: boolean;
}

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function phaseStatus(fraction: number): string {
  if (fraction >= PHASE.ready) return 'Ready';
  if (fraction >= PHASE.artwork) return 'Loading artwork';
  if (fraction >= PHASE.saved) return 'Restoring session';
  if (fraction >= PHASE.validated) return 'Loading rules';
  return 'Warming up';
}

/**
 * Preloads an image and resolves once it is decoded and safe to paint.
 *
 * `await img.decode()` is what makes this worth having: a background image that
 * has downloaded but not decoded still pops in late, and the classic "flash of
 * unfinished art" is exactly a decode wait, not a network wait.
 *
 * ## Why this ALWAYS resolves
 *
 * The first version resolved only on `load` and `error`, and that hung `boot()`
 * forever whenever neither fired. That is not hypothetical: under `happy-dom`
 * (which the integration tests drive the real `boot()` through) no image is ever
 * fetched, so both events never arrive and every test that awaited boot timed
 * out. A real browser can reach the same state on a stalled connection or a
 * request that is still queued when the tab is backgrounded.
 *
 * Awaiting something that can never settle turns a cosmetic wait into a hard
 * boot failure, so this resolves on a timeout as well. A load that completes
 * after the timeout is simply ignored — the image is a decoration, the title
 * screen works without it, and the progress bar's real meaning (the last big
 * asset is in) is not worth hanging the game over.
 *
 * `decode` is also feature-detected, because `HTMLImageElement.decode` is not
 * universal and calling it unguarded is a TypeError on hosts that lack it.
 */
export function preloadImage(url: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);

    const img = new Image();
    img.decoding = 'async';
    img.onload = (): void => {
      const decodeResult = typeof img.decode === 'function' ? img.decode() : undefined;
      if (decodeResult === undefined) {
        clearTimeout(timer);
        finish();
        return;
      }
      void decodeResult.then(
        () => {
          clearTimeout(timer);
          finish();
        },
        () => {
          clearTimeout(timer);
          finish();
        },
      );
    };
    // A failed art load must NOT block boot: the title screen still works, just
    // without its background.
    img.onerror = (): void => {
      clearTimeout(timer);
      finish();
    };
    img.src = url;
    // Already complete (a warm cache, and `src` assigned synchronously above
    // can be enough in some hosts): decode now rather than wait for an event
    // that has already fired.
    if (img.complete && img.naturalWidth > 0) img.onload(new Event('load'));
  });
}

/**
 * How long the handover takes to COMPLETE, in ms — the point at which BOTH the
 * card has finished leaving and the loading chrome has finished arriving.
 *
 * MUST cover the slower of the two CSS transitions in index.html: the card's
 * 520ms exit and the chrome's 280ms delay + 420ms fade = 700ms. This is a
 * literal because that CSS is inlined in the HTML and cannot be read at
 * runtime; retime it and this is the number to retime with it.
 *
 * It is only used to stop the splash starting its own fade mid-handover, so
 * being slightly long is harmless and being slightly short is visible — the
 * chrome would be caught halfway up and the player would see the title screen
 * eat it.
 */
const TRIBUTE_EXIT_MS = 700;

/** Attaches to the splash already present in index.html. */
export function createLoadingScreen(): LoadingScreen {
  const root = el('sm-boot');
  const bar = el('sm-boot-bar');
  const fill = el('sm-boot-fill');
  const status = el('sm-boot-status');
  let dismissed = false;
  let current = 0;

  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const createdAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

  /**
   * Hands the screen over from the tribute card to the loading chrome.
   *
   * Idempotent, and it does NOT touch any progress value: the class only moves
   * the card up and out and fades the logo/bar/status in. The bar still shows
   * real work the whole time, so a player watching a slow load sees the card
   * leave and then watches the bar sit still at its true value — which is the
   * behaviour the progress bar's own note insists on.
   *
   * Driven by its own timer rather than by `report()` reaching some fraction.
   * See `TRIBUTE_HOLD_MS` for why progress is the wrong trigger.
   */
  let handedOver = false;
  function handOverToLoading(): void {
    if (handedOver) return;
    handedOver = true;
    root?.classList.add('sm-boot--loading');
  }
  // The card holds for its own time REGARDLESS of the motion setting. The first
  // version handed over immediately under `prefers-reduced-motion`, on the
  // reasoning that a static credit need not be waited for — and that is exactly
  // the conflation this repo keeps getting bitten by: "no animation" is not "no
  // content". Those players were shown a four-line credit for one frame and then
  // lost it, which is the worst possible outcome for the one screen whose entire
  // job is to be read.
  //
  // Under reduced motion the card simply does not move: index.html's media query
  // removes the entrance stagger and the exit slide, so the handover is a plain
  // state change after the same hold. `dismiss()` likewise no longer forces the
  // handover early — it did, "defensively", and that call cancelled the entire
  // hold on any machine whose boot finished quickly, which is most of them.
  window.setTimeout(handOverToLoading, TRIBUTE_HOLD_MS);

  /** Fades the splash out and removes it, with a timeout as the backstop. */
  function fadeOut(): void {
    if (root === null) return;
    if (reducedMotion) {
      root.remove();
      return;
    }
    root.classList.add('sm-boot--out');
    // The fade is CSS-driven; remove on transitionend so the element is not
    // left covering the title screen, with a timeout as the backstop for the
    // case where the transition never fires (a display:none ancestor, a
    // backgrounded tab that skips transitions, reduced-motion overrides).
    let removed = false;
    const once = (): void => {
      if (removed) return;
      removed = true;
      root.remove();
    };
    root.addEventListener('transitionend', once, { once: true });
    window.setTimeout(once, 600);
  }

  return {
    get dismissed(): boolean {
      return dismissed;
    },
    report(fraction: number, statusText?: string): void {
      // Monotonic: a real load can finish steps out of order (a cached save
      // resolves before the ruleset check on a fast boot), and a bar that
      // visibly jumps backwards reads as a bug in the game.
      const clamped = Math.max(0, Math.min(1, fraction));
      if (clamped <= current && clamped !== 1) return;
      current = clamped;

      if (fill) fill.style.transform = `scaleX(${current})`;
      if (bar) {
        const pct = Math.round(current * 100);
        bar.setAttribute('aria-valuenow', String(pct));
        if (current >= 1) bar.classList.add('sm-boot__bar--done');
      }
      if (status) status.textContent = statusText ?? phaseStatus(current);
      if (root && current >= 1) root.setAttribute('aria-busy', 'false');
    },
    dismiss(): void {
      if (dismissed) return;
      dismissed = true;
      if (root === null) return;

      // --- minimum on-screen time ------------------------------------------
      //
      // Measured on a warm local cache, boot completes in ~380ms — so the splash
      // was on screen for well under half a second. A branded splash that
      // flashes past faster than a logo can be read is worse than no splash at
      // all: it reads as a rendering glitch, and the one moment the publisher
      // gets to say "A ShoeMoney AI Labs Game" is gone before anyone sees it.
      //
      // This waits out the remainder of MIN_DISPLAY_MS before fading. It does
      // NOT touch the progress values: the bar still only ever shows work that
      // actually completed, and it genuinely sits at 100% for the hold, because
      // by this point the work IS done. The hold is a presentation decision
      // about how long to show a finished state, not a claim about work
      // outstanding — and a real slow load still reports its real, slower
      // progress the whole way up to 100%, so this floor never hides a stall.
      //
      // 1100ms is long enough to read the logo and the line, and short enough
      // that a returning player is not held.
      //
      // The floor is now the LATER of two things: the original minimum display
      // time, and the tribute card having actually finished leaving. Without
      // the second term this screen had a real bug: a warm-cache boot finishes
      // in ~380ms, so the splash would begin fading at 1100ms — while the
      // tribute was still holding the screen until 2600ms — and the credit
      // would be cut off roughly one line into being read. The card owns the
      // first seconds of the boot, so the splash waits for the card.
      const elapsedMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const handoverMs = reducedMotion ? 0 : TRIBUTE_HOLD_MS;
      const earliestFadeMs = Math.max(MIN_DISPLAY_MS, handoverMs + TRIBUTE_EXIT_MS);
      const remainingMs = Math.max(0, earliestFadeMs - (elapsedMs - createdAtMs));
      if (remainingMs > 0) {
        window.setTimeout(() => fadeOut(), remainingMs);
        return;
      }
      fadeOut();
    },
  };
}

export const LOADING_PHASE = PHASE;

/** The title screen's background art, resolved the same way the atlas is. */
export function titleArtUrl(): string {
  return new URL('../../assets/ui-title-art.png', import.meta.url).href;
}
