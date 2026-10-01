/**
 * index.html and README.md are markup and prose, not code, so nothing
 * exercises them today: a share card can point at a relative image URL
 * that 404s under the live /smduel/ subpath, a "back to the arcade" link
 * can get "tidied" into #app and get wiped by the next screen's
 * clearAndAppend, or a stale "AutoDuel" name can creep back in, and the
 * type checker and the game's own test suite would both stay green.
 *
 * This file reads the two shipped files directly off disk with node:fs
 * and asserts on their text, closing that gap. It runs in the project's
 * default `node` environment (see vite.config.ts) so it deliberately does
 * not parse the HTML into a DOM; every assertion below is a plain string
 * check.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

function metaContent(html: string, attrPattern: string): string | undefined {
  const match = html.match(new RegExp(`<meta[^>]*${attrPattern}[^>]*content="([^"]*)"[^>]*>`));
  if (match) return match[1];
  // content may appear before the name/property attribute
  const reversed = html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attrPattern}[^>]*>`));
  return reversed?.[1];
}

describe('index.html — share metadata', () => {
  it('points og:image at the absolute, already-live arcade URL', () => {
    const ogImage = metaContent(INDEX_HTML, 'property="og:image"');
    expect(ogImage).toBe('https://arcade.shoemoney.com/brand/smduel-gameplay.png');
  });

  it('points twitter:image at the same absolute arcade URL', () => {
    const twitterImage = metaContent(INDEX_HTML, 'name="twitter:image"');
    expect(twitterImage).toBe('https://arcade.shoemoney.com/brand/smduel-gameplay.png');
  });

  it('every image meta tag carries an absolute https URL, never a relative or root-relative path', () => {
    // A root-relative `/assets/...` 404s under the live /smduel/ subpath,
    // and a `./`-relative path is never rewritten by vite in a meta tag
    // (vite only rewrites link[href]/img[src]/video/source/use[href]), so
    // either shape would silently ship a broken share card. This scans
    // every <meta> tag whose name/property mentions "image" instead of
    // pinning just og:image and twitter:image, so a new or renamed image
    // meta tag is covered without touching this test. The at-least-two
    // assertion guards against the scan itself silently matching nothing,
    // which would otherwise make the whole check vacuous.
    const metaTags = INDEX_HTML.match(/<meta\b[^>]*>/g) ?? [];
    const imageUrlTags = metaTags
      .map((tag) => {
        const attr = tag.match(/(?:name|property)="([^"]*image[^"]*)"/i);
        const content = tag.match(/content="([^"]*)"/);
        return attr && content ? { attr: attr[1], value: content[1] } : undefined;
      })
      .filter((tag): tag is { attr: string; value: string } => tag !== undefined)
      // og:image:width/height/alt describe the image, they are not URLs.
      .filter((tag) => !/:(width|height|alt)$/i.test(tag.attr));

    expect(imageUrlTags.length).toBeGreaterThanOrEqual(2);
    for (const tag of imageUrlTags) {
      expect(tag.value.startsWith('https://')).toBe(true);
    }
  });

  it('sets og:url and the canonical link to the exact live game URL', () => {
    const ogUrl = metaContent(INDEX_HTML, 'property="og:url"');
    expect(ogUrl).toBe('https://arcade.shoemoney.com/smduel/');

    const canonicalMatch = INDEX_HTML.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"[^>]*>/);
    expect(canonicalMatch?.[1]).toBe('https://arcade.shoemoney.com/smduel/');
  });

  it('has a non-empty meta description', () => {
    const description = metaContent(INDEX_HTML, 'name="description"');
    expect(description).toBeDefined();
    expect(description?.trim().length).toBeGreaterThan(0);
  });

  it('declares a summary_large_image twitter card', () => {
    const card = metaContent(INDEX_HTML, 'name="twitter:card"');
    expect(card).toBe('summary_large_image');
  });
});

describe('index.html — arcade home link', () => {
  it('links back to the arcade root', () => {
    expect(INDEX_HTML).toMatch(/<a[^>]*href="https:\/\/arcade\.shoemoney\.com\/"/);
  });

  it('places the arcade link outside #app, not inside it', () => {
    // Anything mounted inside #app gets wiped on the next screen change by
    // src/app.ts's clearAndAppend (root.innerHTML = ''). The link has to
    // sit before <div id="app"> in source order to survive every screen.
    const linkIndex = INDEX_HTML.indexOf('arcade.shoemoney.com/"');
    const appDivIndex = INDEX_HTML.indexOf('<div id="app">');
    expect(linkIndex).toBeGreaterThan(-1);
    expect(appDivIndex).toBeGreaterThan(-1);
    expect(linkIndex).toBeLessThan(appDivIndex);

    // And it must not appear again between <div id="app"> and its closing
    // tag, in case a duplicate ever gets added inside the mount point.
    const appOpenToClose = INDEX_HTML.slice(appDivIndex, INDEX_HTML.indexOf('</div>', appDivIndex));
    expect(appOpenToClose).not.toContain('arcade.shoemoney.com/"');
  });
});

describe('index.html — mobile viewport', () => {
  it('gives #app a dvh height with a vh fallback', () => {
    // The rule used to live in a <style> block inside index.html. It now lives
    // in src/ui/tokens.css, because the page's global CSS was extracted into a
    // token layer that every screen shares. Asserting on index.html alone made
    // this test fail for a pure refactor while the actual mobile behaviour was
    // unchanged — and, worse, it would have kept passing if the rule had been
    // deleted from BOTH files. So the search covers the stylesheet that owns it
    // now, and the file list is what makes the relocation explicit.
    const sources = [INDEX_HTML, readFileSync(new URL('../../src/ui/tokens.css', import.meta.url), 'utf8')].join('\n');
    const appRuleMatch = sources.match(/#app\s*{([^}]*)}/);
    expect(appRuleMatch, 'no #app rule found in index.html or src/ui/tokens.css').not.toBeNull();
    const appRule = appRuleMatch?.[1] ?? '';
    expect(appRule).toMatch(/height:\s*100vh/);
    expect(appRule).toMatch(/height:\s*100dvh/);
    // `dvh` must come AFTER `vh` or it is dead code in browsers that do not
    // understand it, which is the entire point of shipping both.
    expect(appRule.indexOf('100dvh')).toBeGreaterThan(appRule.indexOf('100vh'));
  });
});

// These two blocks used to assert the OPPOSITE of what they assert now, and the
// inversion is the point rather than a convenience.
//
// They read `expect(...).not.toContain('AutoDuel')` — a guard written when the
// game was deliberately unnamed, to keep a clean-room reimplementation from
// reading as the original. It was a real guard and it really did pass, but only
// by a capitalisation accident: the splash spells the game "Autoduel" (lower-case
// d), so a search for "AutoDuel" never matched it. A guard that passes because
// of a letter case is not a guard, it is a coincidence that has been re-run a
// hundred times.
//
// The game is now named OpenDuel and positioned explicitly as a tribute to
// _Autoduel_, so naming the original is the requirement. The guard that
// actually matters is therefore the opposite one: the credit must be PRESENT and
// must ATTRIBUTE — the designers and the publisher named alongside the title —
// because a tribute that stops naming what it pays homage to is the failure mode
// worth preventing. A "must not mention" check deleted at the user's request
// would leave nothing behind; a "must attribute" check is stronger than what it
// replaced.
describe('index.html — the name is OpenDuel and the tribute is attributed', () => {
  it('has the OpenDuel title carrying the tribute descriptor', () => {
    expect(INDEX_HTML).toMatch(/<title>OpenDuel — A Modern Tribute to Autoduel<\/title>/);
  });

  it('never presents itself AS Autoduel — the wordmark and social titles are OpenDuel', () => {
    // The guard the old block was reaching for, stated correctly: the original
    // game's name may appear as an attributed tribute but must not BE the
    // product's name. This is what actually prevents passing off.
    // "Must not CONTAIN Autoduel" was my first attempt and it was wrong: the
    // title legitimately contains the word, as the tribute it is. The requirement
    // is that the name LEADING the title is OpenDuel, so that is what is pinned —
    // a title beginning with "Autoduel" is the thing that would read as passing
    // off, and it is the only version of this that a real regression produces.
    expect(INDEX_HTML).toMatch(/<title>OpenDuel/);
    expect(INDEX_HTML).toMatch(/og:title" content="OpenDuel/);
    expect(INDEX_HTML).not.toMatch(/<title>Autoduel/);
  });

  it('credits the original on the boot tribute: publisher, designers, platform and year', () => {
    expect(INDEX_HTML).toContain('Apple II');
    expect(INDEX_HTML).toContain('Autoduel (1985)');
    expect(INDEX_HTML).toContain('Origin Systems');
    expect(INDEX_HTML).toContain('Chuckles and Lord British');
  });
});

describe('README.md — the name is OpenDuel and the tribute is attributed', () => {
  it('starts with "# OpenDuel"', () => {
    expect(README.split('\n')[0]).toBe('# OpenDuel');
  });

  it('names Autoduel, its publisher, its designers and its platform', () => {
    expect(README).toContain('Autoduel');
    expect(README).toContain('Origin Systems');
    expect(README).toContain('Chuckles and Lord British');
    expect(README).toContain('Apple II');
  });

  it('still states the clean-room position: no original code or assets', () => {
    // The rename makes naming the original REQUIRED; it must not quietly become a
    // claim of affiliation. Both halves have to hold at once.
    expect(README).toMatch(/clean-room/i);
    expect(README).toMatch(/not affiliated with/i);
  });
});

// ---------------------------------------------------------------------------
// README sync — the numbers in the prose are checked against the real data
// ---------------------------------------------------------------------------
//
// A README that quotes a stale figure is worse than one that quotes none,
// because it is believed. This block pins the counts a change to the GAME would
// move — cities, routes, facility kinds, armour facings, ruleset files — by
// reading the same source of truth the game reads, then requiring the README to
// say the same thing. Add a seventeenth city and the build fails until the
// documentation admits it.
//
// The TEST COUNT deliberately is not in here. It moves on every commit that adds
// a test, so an exact figure in the README is either noise (edited constantly) or
// a lie (stale within a week), and pinning it gates nothing. The README states it
// as a floor for the same reason: growth never falsifies "1,592+".

describe('README.md — the quoted numbers match the game', () => {
  const ruleset = <T,>(file: string): T => JSON.parse(readFileSync(new URL(`../../rulesets/classic/${file}`, import.meta.url), 'utf8')) as T;
  const cities = ruleset<{ cities: unknown[]; routes: unknown[]; facilityKinds: unknown[] }>('cities.json');
  const skills = ruleset<{ skills: string[] }>('skills.json');

  /**
   * Asserts the README's table row for `label` states `value`.
   *
   * The first version of this searched the whole file for the bare number, and it
   * was worthless: adding a seventeenth city left the suite GREEN, because "17"
   * already appeared in the ruleset-file row. A number appearing SOMEWHERE is not
   * a statement about what it refers to — which is the same defect the skill
   * warns about for a shields.io badge, where `tests-1592%20methods` is invisible
   * to a grep for "1592". Presence is not attribution.
   *
   * So the assertion is scoped to the row that carries the label, and it requires
   * the value in bold, exactly as the table writes it.
   */
  function expectRowSays(label: string, value: number): void {
    const row = README.split('\n').find((line) => line.trimStart().startsWith(`| ${label} |`));
    expect(row, `README has no table row labelled "${label}"`).toBeDefined();
    expect(row, `README row "${label}" should state ${value}`).toMatch(new RegExp(`\\*\\*${value}\\*\\*`));
  }

  it('quotes the real city count', () => {
    expectRowSays('Cities', cities.cities.length);
  });

  it('quotes the real route count', () => {
    expectRowSays('Routes between them', cities.routes.length);
  });

  it('quotes the real facility-kind count', () => {
    expectRowSays('Facility kinds', cities.facilityKinds.length);
  });

  it('quotes the real starting-skill count', () => {
    expectRowSays('Starting skills', skills.skills.length);
  });

  it('quotes the real armour-facing count', () => {
    // FACINGS is the game's own constant; the README's five armour rows are a
    // rendering of it, so a sixth facing must be a documentation change too.
    const facings = (readFileSync(new URL('../../src/sim/types.ts', import.meta.url), 'utf8').match(
      /export const FACINGS = \[([^\]]*)\]/,
    )?.[1] ?? '').match(/'([A-Z]+)'/g);
    expect(facings).not.toBeNull();
    expectRowSays('Armour facings', facings?.length ?? 0);
  });

  it('quotes the real ruleset file count', () => {
    const dir = new URL('../../rulesets/classic/', import.meta.url);
    const files = Array.from(readFileSyncSafe(dir)).filter((f) => /\.(json|ya?ml)$/.test(f));
    // 16 JSON + the fidelity ledger.
    expectRowSays('Ruleset files', files.length);
  });

  it('states the test count as a FLOOR in the prose AND in the badge', () => {
    // A bare "1592 tests" is falsified by the next commit that adds a test, and
    // the failure is invisible until someone reads the number. A floor is the only
    // honest form for a figure that grows with every change.
    // `\*{0,2}` because the figure is bolded in the prose — `**1,592+** tests` —
    // and a regex that demanded a bare space would fail on correct markdown while
    // passing on a wrong number written without emphasis.
    expect(README).toMatch(/1,?592\+\*{0,2}\s*tests/i);
    expect(README, 'the README must not pin the test count to an exact figure').not.toMatch(/\b1,?592\*{0,2}\s+tests\b/);
  });

  it('floors the test count in the BADGE too, in its URL-encoded form', () => {
    // The badge is the same number, URL-encoded — `1%2C592%2B` — so a sweep for
    // "1592" or even "1,592" never sees it. That is how a badge stays stale
    // through several prose corrections: it is a SEPARATE copy that no grep
    // matches. Both copies are therefore checked here, in one test, on purpose.
    expect(README).toContain('tests-1%2C592%2B%20passing');
    expect(README, 'the badge must not pin an exact test count').not.toMatch(/tests-1592%20/);
    expect(README, 'the badge must not pin an exact test count').not.toMatch(/tests-1%2C592%20/);
  });

  it('names the tribute and its attribution wherever the name appears', () => {
    // The name changed once already (smduel -> OpenDuel). A doc that half-adopted
    // it would be the confusing case, so the headline and the credits are pinned
    // together.
    expect(README).toMatch(/^# OpenDuel$/m);
    expect(README).toMatch(/Autoduel/);
    expect(README).toMatch(/Origin Systems/);
    expect(README).toMatch(/Chuckles and Lord British/);
    expect(README).toMatch(/Apple II/);
  });
});

/** `readdirSync` through a file: URL, kept out of the test body for clarity. */
function readFileSyncSafe(dirUrl: URL): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(dirUrl);
}

describe('README.md — its own structure holds together', () => {
  // The TOC in this file was written with emoji-bearing headings and
  // hand-encoded anchors, and THREE of the fifteen links were broken: two
  // resolved to a slug no renderer produces, and one was a literal
  // `%EF%B8%8F` in the source. Emoji-derived heading slugs are
  // renderer-dependent — GitHub strips the emoji and keeps the space it
  // occupied, and Forgejo and GitLab have each been seen to differ — so the
  // headings now carry explicit `<a id>` anchors and this pins them.
  //
  // A broken TOC is the most common documentation defect and the least likely to
  // be noticed, because the README still looks perfect in a renderer that simply
  // does not jump.

  const anchors = new Set([...README.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));

  it('defines an explicit anchor for every in-page link', () => {
    const links = [...README.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(10);
    const dangling = [...new Set(links.filter((l) => !anchors.has(l)))];
    expect(dangling, `README links to anchors that do not exist: ${dangling.join(', ')}`).toEqual([]);
  });

  it('uses no percent-encoded anchor, which no renderer resolves', () => {
    // The `%EF%B8%8F` link was a variation selector pasted by hand. It renders
    // literally in the source and jumps nowhere.
    expect(README).not.toMatch(/\]\(#%/);
  });

  it('balances its fenced blocks, so no diagram swallows the rest of the file', () => {
    const fences = (README.match(/^```/gm) ?? []).length;
    expect(fences % 2, 'README has an odd number of ``` fences — a block is unclosed').toBe(0);
  });

  it('opens every mermaid block with a diagram type', () => {
    const blocks = [...README.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      expect(block.trimStart()).toMatch(/^(flowchart|graph|sequenceDiagram|mindmap|stateDiagram-v2|gitGraph)\b/);
    }
  });
});

describe('the Controls screen never lies about the player\'s money', () => {
  // Reported in two of five advisory review rounds, by reading the header in a
  // frame: "Controls menu header displays incorrect cash balance ($0 instead of
  // $5)". Real, and structural: `showControls` hardcoded `cash: 0` while being
  // reachable from the TITLE, the CITY and the ROAD — so the two in-game paths
  // showed a balance of zero beside a player carrying real money, in a status
  // line whose entire job is to state the truth.
  //
  // Asserted on the SOURCE rather than on a rendered header, because the title
  // path legitimately shows $0 and a rendering-only test cannot tell a correct
  // zero from a hardcoded one.
  const APP = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');

  it('takes cash as a parameter instead of hardcoding it', () => {
    // Matched with `[\s\S]*?` because the signature contains `() => void`, and a
    // `[^)]*` character class stops at that first paren.
    expect(APP).toMatch(/function showControls\([\s\S]*?cash\s*=\s*0\)/);
    const header = /function showControls\([\s\S]*?header:\s*\{[^}]*\}/.exec(APP)?.[0] ?? '';
    expect(header, 'the Controls header should use the parameter').toContain('cash');
    expect(header, 'the Controls header must not hardcode a balance').not.toMatch(/cash:\s*0\b/);
  });

  it('passes a real balance from every call site that has a driver', () => {
    // The DECLARATION is removed first, because `showControls(` matches it too and
    // a declaration is not a call site. An earlier version of this matched the
    // declaration and then failed on a call that was perfectly correct.
    const callsOnly = APP.replace(/function showControls\([\s\S]*?\n\}/, '');
    const calls = [...callsOnly.matchAll(/showControls\(([\s\S]*?)\);/g)].map((m) => m[1] ?? '');
    expect(calls.length, 'expected the showControls call sites').toBeGreaterThanOrEqual(3);
    // A call that returns to the TITLE has no driver, so $0 is the truth there.
    // Every OTHER call must carry a balance: those are the city, arena and road
    // paths, and each of them was reported by a reviewer before this test existed.
    const inGame = calls.filter((c) => !/showTitle\(/.test(c));
    const title = calls.filter((c) => /showTitle\(/.test(c));
    expect(title.length, 'the title path should still reach Controls').toBeGreaterThan(0);
    expect(inGame.length, 'expected at least one in-game Controls call').toBeGreaterThan(0);
    for (const c of inGame) {
      expect(c, `an in-game showControls call carries no balance:\n${c}`).toMatch(/cash/);
    }
  });
});
