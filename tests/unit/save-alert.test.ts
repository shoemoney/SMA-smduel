// @vitest-environment happy-dom
/**
 * The save-failure banner.
 *
 * This exists because of a specific, silent defect: the autosave path caught
 * every failure and logged it to the console, so a player whose progress was not
 * being written — quota exhausted, storage blocked in private browsing — saw a
 * game that looked healthy and only discovered the loss after closing the tab.
 *
 * The properties worth pinning are the ones that make it actually reach a player:
 * it survives a screen change, it is announced rather than silent, it says what
 * is wrong in words rather than a code, and it does not vanish on its own while
 * the condition may still be true.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearSaveFailure, saveFailureVisible, showSaveFailure } from '@/ui/save-alert';

function bannerText(): string {
  return document.querySelector('.sm-save-failure__text')?.textContent ?? '';
}

describe('save-failure banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    clearSaveFailure();
  });

  it('is NOT shown until a failure happens', () => {
    // The trivial assertion that still matters: a banner wired into the wrong
    // branch would otherwise be "always on" and read as noise forever.
    expect(saveFailureVisible()).toBe(false);
  });

  it('appears with a plain-English reason, not a code or a stack', () => {
    showSaveFailure(new DOMException('exceeded', 'QuotaExceededError'));
    expect(saveFailureVisible()).toBe(true);
    const text = bannerText();
    expect(text).toContain('NOT being saved');
    // Quota is the one cause the player can act on, so it gets its own words.
    expect(text).toContain('out of storage space');
    expect(text).not.toContain('QuotaExceededError');
    expect(text).not.toContain('DOMException');
  });

  it('distinguishes the other two real causes', () => {
    showSaveFailure(new DOMException('blocked', 'SecurityError'));
    expect(bannerText()).toContain('private browsing');

    clearSaveFailure();
    showSaveFailure(new Error('something else'));
    // An unrecognised error still tells the player the important thing: the save
    // is not happening. It does not claim a cause it cannot support.
    expect(bannerText()).toContain('NOT being saved');
    expect(bannerText()).not.toContain('private browsing');
  });

  it('survives the screen being torn down and replaced', () => {
    // THE reason it is parented to `document.body`. Screens replace `#app`'s
    // children (`clearAndAppend(root, ...)`), so a banner parented inside a
    // screen would be destroyed by the next navigation — which is precisely the
    // silence this file exists to end.
    //
    // The first version of this test modelled the teardown as
    // `document.body.innerHTML = ...`, which also destroys the banner, and so
    // failed for a reason that had nothing to do with the code: nuking the body
    // is not a thing this game does.
    document.body.innerHTML = '<div id="app"><div class="sm-screen">city</div></div>';
    showSaveFailure(new Error('boom'));
    // What a real screen change does:
    document.getElementById('app')?.replaceChildren();
    expect(saveFailureVisible()).toBe(true);
  });

  it('is announced to assistive tech rather than sitting there silently', () => {
    showSaveFailure(new Error('boom'));
    // A visible banner with no role is still a silent banner to a screen reader.
    expect(document.querySelector('.sm-save-failure')?.getAttribute('role')).toBe('alert');
  });

  it('does not auto-dismiss, but can be dismissed by the player', () => {
    showSaveFailure(new Error('boom'));
    expect(saveFailureVisible()).toBe(true);
    // No timer: the condition may still be true, and a message that removes
    // itself has said nothing by the time the player looks back.
    document.querySelector<HTMLButtonElement>('.sm-save-failure__dismiss')?.click();
    expect(saveFailureVisible()).toBe(false);
  });

  it('refreshes rather than stacking when a second save fails', () => {
    showSaveFailure(new DOMException('x', 'QuotaExceededError'));
    showSaveFailure(new DOMException('x', 'SecurityError'));
    // Two banners would be two things to read; the newest cause is the useful one.
    expect(document.querySelectorAll('.sm-save-failure')).toHaveLength(1);
    expect(bannerText()).toContain('private browsing');
  });
});