/**
 * The save-failure banner.
 *
 * ## Why this exists
 *
 * The autosave path ended in:
 *
 *     } catch (error) {
 *       console.warn('smduel: autosave failed', error);
 *     }
 *
 * which is the worst possible failure mode for a game with a campaign in it. The
 * write failed — quota exhausted, IndexedDB blocked in private browsing, disk
 * full, a corrupted generation — and the player was told NOTHING. The game
 * carried on looking exactly as though progress were being kept, and the loss
 * only became visible when they closed the tab and came back to a stale save.
 *
 * A console warning is for developers. A player who is about to lose two hours of
 * courier runs needs to be told while there is still something they can do about
 * it.
 *
 * ## Why it lives on `document.body`
 *
 * The failure can happen on any screen, and every screen replaces its own
 * subtree. An element parented to the body survives every screen change, so the
 * banner cannot be wiped by the next `clearAndAppend` — which is exactly how a
 * per-screen message would behave.
 *
 * The banner is deliberately NOT auto-dismissing: the condition may still be
 * true, and a message that quietly removes itself has told the player nothing by
 * the time they look away. It stays until they dismiss it, and re-arms if a
 * later save fails again.
 */

const BANNER_ID = 'sm-save-failure';

import { t } from './strings';

/** A short, non-alarming reason drawn from the error itself, never a raw stack. */
function describe(error: unknown): string {
  if (error instanceof DOMException) {
    // QuotaExceededError is by far the most common cause and the only one the
    // player can act on, so it gets its own wording rather than a code.
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return t('ui.saveFailure.quota');
    }
    if (error.name === 'SecurityError') return t('ui.saveFailure.blocked');
    return t('ui.saveFailure.generic');
  }
  return t('ui.saveFailure.generic');
}

/**
 * Shows the banner. Safe to call repeatedly: a second failure while the banner
 * is already up refreshes its timestamp rather than stacking a second copy.
 */
export function showSaveFailure(error: unknown): void {
  if (typeof document === 'undefined' || document.body === null) return;
  let banner = document.getElementById(BANNER_ID);
  if (banner === null) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    // `role="alert"` so it is announced rather than sitting there silently — the
    // whole point of this file is that silence is the bug.
    banner.setAttribute('role', 'alert');
    banner.className = 'sm-save-failure';
    const text = document.createElement('span');
    text.className = 'sm-save-failure__text';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'sm-save-failure__dismiss';
    dismiss.textContent = t('ui.saveFailure.dismissGlyph');
    dismiss.setAttribute('aria-label', t('ui.saveFailure.dismiss'));
    dismiss.addEventListener('click', () => banner?.remove());
    banner.appendChild(text);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
  }
  const text = banner.querySelector('.sm-save-failure__text');
  if (text !== null) {
    text.textContent = t('ui.saveFailure.body', { reason: describe(error) });
  }
}

/** Removes the banner. Exported so a test can assert the dismissal path. */
export function clearSaveFailure(): void {
  document.getElementById(BANNER_ID)?.remove();
}

/** True while the banner is on screen. */
export function saveFailureVisible(): boolean {
  return typeof document !== 'undefined' && document.getElementById(BANNER_ID) !== null;
}