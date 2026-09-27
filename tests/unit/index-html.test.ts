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
    const appRuleMatch = INDEX_HTML.match(/#app\s*{([^}]*)}/);
    expect(appRuleMatch).not.toBeNull();
    const appRule = appRuleMatch?.[1] ?? '';
    expect(appRule).toMatch(/height:\s*100vh/);
    expect(appRule).toMatch(/height:\s*100dvh/);
  });
});

describe('index.html — the name is smduel', () => {
  it('has the exact title "smduel"', () => {
    expect(INDEX_HTML).toMatch(/<title>smduel<\/title>/);
  });

  it('contains no occurrence of AutoDuel', () => {
    expect(INDEX_HTML).not.toContain('AutoDuel');
  });
});

describe('README.md — the name is smduel', () => {
  it('starts with "# smduel"', () => {
    expect(README.split('\n')[0]).toBe('# smduel');
  });

  it('contains no occurrence of AutoDuel', () => {
    expect(README).not.toContain('AutoDuel');
  });
});
