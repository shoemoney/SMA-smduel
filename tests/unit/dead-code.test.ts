/**
 * Repo hygiene gate: nothing may be DECLARED AND EXPORTED that nothing reads.
 *
 * `tsc --noEmit` cannot catch this class. `noUnusedLocals` flags an unused
 * local, but an unused *export* is a legal, fully-typed program: sixteen
 * accessors were exported from `src/`, referenced by no module, no test and
 * no tool, and the typecheck passed the whole time. The three
 * `CITY_GROUND_*` constants are the clearest case - they were orphaned when
 * the city ground field moved to a single `groundQuad()` call and kept their
 * explanatory doc comments, which read as if they were load-bearing.
 *
 * This gate is deliberately a SCAN, not a hand-maintained list. A list would
 * rot: someone adds a 17th orphan, the list still says sixteen, and the gate
 * reports success while the dead code sits there. The list this file does
 * keep - `RUNTIME_COMPOSED_CSS` - is different in kind, and is explained at
 * its own definition.
 *
 * What counts as "read":
 *   - an import statement naming the export (the normal case)
 *   - any other reference to the identifier in a .ts/.mjs/.js file
 * A mention inside a comment is NOT a reference, and neither is the
 * declaration's own line. Both are excluded, because a doc comment that
 * explains a function is the single most reliable way for a genuinely dead
 * export to survive a code review.
 *
 * Scope is value exports (function/class/const). Type-only exports are
 * excluded on purpose: an exported `interface` that is only referenced inside
 * its own module is a declaration-site choice, not dead behaviour, and
 * deleting one is a refactor with no observable effect. This gate is for code
 * that exists to run.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

const SCAN_DIRS = ['src', 'tests', 'tools'] as const;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.shots', '.playwright-mcp']);

/** Every scannable source file, repo-relative, forward-slashed. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => sourceFiles(d));
const ALL_SRC = FILES.map((f) => readFileSync(path.join(REPO, f), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Exported values nothing references
// ---------------------------------------------------------------------------

interface Declaration {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

/** Every `export function|class|const` in src/, with its 1-based line. */
function exportedValues(): Declaration[] {
  const found: Declaration[] = [];
  for (const file of FILES.filter((f) => f.startsWith('src/'))) {
    readFileSync(path.join(REPO, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const match = line.match(
          /^\s*export\s+(?:abstract\s+)?(?:class\s+([A-Za-z_$][\w$]*)|(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/,
        );
        const name = match?.[1] ?? match?.[2] ?? match?.[3];
        if (name !== undefined) found.push({ name, file, line: i + 1 });
      });
  }
  return found;
}

/**
 * Identifiers appearing in `text`, minus comment bodies.
 *
 * Comment bodies are blanked CHARACTER BY CHARACTER rather than deleted, so
 * every byte offset and line number survives. This is not fussiness: an
 * earlier version replaced each comment with a single space, which collapsed
 * each multi-line doc comment onto one line and renumbered everything after
 * it. The "skip the declaration's own line" step then skipped the wrong line,
 * the declaration matched itself, and this gate reported ZERO dead exports on
 * a tree that had sixteen. A hygiene check that cannot fail is worse than no
 * check, so the invariant is: this function must be length-preserving.
 */
function codeOnly(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/.*$/gm, blank);
}

describe('no exported value in src/ is unreferenced', () => {
  it('every export is read by at least one import, call, or type position', () => {
    const bodies = ALL_SRC.map(codeOnly);
    const dead: string[] = [];

    for (const decl of exportedValues()) {
      const word = new RegExp(`(?<![\\w$.])${decl.name}(?![\\w$])`, 'g');
      let referenced = false;
      for (let f = 0; f < FILES.length && !referenced; f++) {
        const lines = bodies[f]!.split('\n');
        for (let i = 0; i < lines.length && !referenced; i++) {
          if (FILES[f] === decl.file && i + 1 === decl.line) continue; // the declaration itself
          word.lastIndex = 0;
          if (word.test(lines[i]!)) referenced = true;
        }
      }
      if (!referenced) dead.push(`${decl.file}:${decl.line} ${decl.name}`);
    }

    expect(
      dead,
      'these exports are declared and never referenced. Delete them, or wire them up ' +
        'and add the call site. An export nothing reads cannot fail a test, because no ' +
        'test can reach it either.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. CSS classes that no element ever carries
// ---------------------------------------------------------------------------

/**
 * Classes the code composes at runtime from a value this gate cannot see.
 *
 * `button()` builds `sm-btn--${options.variant}`; `renderHud` builds
 * `hud-message--${message.kind}`. A static scan sees the prefix and no
 * complete name, so these would read as orphans. Listing the prefix is
 * honest about the limitation - the real variants are constrained by the
 * `variant` union and `HudMessageKind` respectively, and both unions are
 * type-checked, so a new variant cannot appear without a code edit.
 */
const RUNTIME_COMPOSED_CSS = [
  'sm-btn--',
  'sm-stat--',
  'hud-message--',
  'hud-radar-contact--',
  'sm-builder__row--',
] as const;

const STYLESHEETS = [
  'src/ui/builder.css',
  'src/ui/controls.css',
  'src/ui/hud.css',
  'src/ui/menu.css',
  'src/ui/tokens.css',
  'src/ui/touch.css',
] as const;

const CLASS_NAME = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;

/** CSS with comments blanked out, so prose can never look like a selector. */
function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Selector classes defined in a stylesheet's rules.
 *
 * Comments are removed first. Without that, a doc comment in hud.css that
 * writes `.hud-nav-reserved: 52px` to explain a past mistake registers as a
 * live rule, and the comment's own explanation becomes an "orphan".
 */
function definedClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const match of withoutCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!;
    // A selector cannot contain markup, a string, or an at-rule. The `@`
    // and `;` exclusions matter: `@import './tokens.css';` precedes the first
    // real rule, and without them the text between the previous `}` and the
    // next `{` is taken as a selector, registering `.css` as a live class.
    if (/[<>"'`@;]/.test(selector)) continue;
    for (const cls of selector.matchAll(CLASS_NAME)) out.add(cls[1]!);
  }
  return out;
}

/**
 * Every quoted string within a bounded window after a class-carrying anchor.
 *
 * Reading only the literal that FOLLOWS the anchor is not enough. The codebase
 * writes `el.className = cond ? 'sm-btn' : \`sm-btn sm-btn--${v}\`` and
 * `class: \`hud-message hud-message--${kind}\``, and the HUD's own helper takes
 * `{ class: 'hud-x' }` as an object-literal property. A regex that insists on
 * a literal in the anchor's own quote pair sees none of those, which is how an
 * earlier pass of this gate reported all 70 hud.css classes as dead.
 */
function windowAfter(text: string, from: number): string {
  // Quote-aware on purpose. A naive bracket counter stops at the `}` that
  // closes a `${...}` placeholder, so `` `hud-zone${selected}` `` is cut to
  // `hud-zone${selected` with its backtick still open, the literal regex
  // never finds a closing quote, and a class the element genuinely carries
  // reports as an orphan.
  let quote: string | null = null;
  let group = 0;
  for (let i = from; i < text.length && i < from + 400; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === ')' || ch === ']') {
      if (group === 0) return text.slice(from, i);
      group--;
    } else if (ch === '(' || ch === '[') {
      group++;
    } else if (ch === ';' && group === 0) {
      return text.slice(from, i);
    }
  }
  return text.slice(from, from + 400);
}

/**
 * Quoted literals held by a local `const`, keyed by variable name.
 *
 * `builder-preview.ts` computes `const selected = cond ? ' sm-x--selected' : ''`
 * and then interpolates `${selected}` into a `setAttribute('class', ...)` a few
 * lines later. The class text is real and the element really does carry it,
 * but it is nowhere near a class-carrying anchor, so a positional scan calls
 * it an orphan. Resolving one level of local const covers that idiom without
 * pretending to do real dataflow analysis.
 */
function localConstLiterals(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // Reads COMMENT-STRIPPED text, for a reason this file learned the hard way:
  // this test's own doc comment contains `const selected = cond ? ' sm-x--selected'`,
  // and scanning raw text let that comment overwrite the real `selected` in
  // builder-preview.ts, so the gate reported a class it is itself describing.
  // A gate that is fooled by its own prose is not a gate.
  for (const text of ALL_SRC.map(codeOnly)) {
    for (const decl of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;]+);/g)) {
      const literals = [...decl[2]!.matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]!);
      // Merge, never overwrite: `selected` is a common local name and any
      // single definition must not mask the others.
      map.set(decl[1]!, [...(map.get(decl[1]!) ?? []), ...literals]);
    }
  }
  return map;
}

const CONST_LITERALS = localConstLiterals();

/** Class names the code puts on an element, from every position that can. */
function usedClasses(): Set<string> {
  const out = new Set<string>();
  const add = (value: string): void => {
    for (const cls of value.split(/[\s'"`]+/)) if (cls !== '') out.add(cls);
  };
  const addWindow = (text: string, from: number): void => {
    // Each quoted literal in the window is a candidate class list. A
    // `${...}` placeholder contributes no name of its own, but the literals
    // nested inside it do: `${ready ? ' hud-x--ready' : ''}`.
    for (const literal of windowAfter(text, from).matchAll(/(['"`])([\s\S]*?)\1/g)) {
      const value = literal[2]!;
      if (value.includes('${')) {
        for (const segment of value.split(/\$\{[^}]*\}/)) add(segment);
        for (const nested of value.matchAll(/\$\{[\s\S]*?(['"`])([\s\S]*?)\1/g)) add(nested[2]!);
        // `${selected}` - a local const holding class text.
        for (const name of value.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
          for (const held of CONST_LITERALS.get(name[1]!) ?? []) add(held);
        }
      } else {
        add(value);
      }
    }
  };
  // Anchors only - the class text is harvested from the window after each.
  const anchors = [
    /\bclass\s*=/g,
    /\bclassName\s*[:=]/g,
    /\bclass\s*:/g,
    /\bclassList\s*\./g,
    /setAttribute\(\s*['"`]class['"`]/g,
    // app.ts's `el(tag, className, text?)` helper takes the class as a
    // POSITIONAL argument, so there is no `class=` or `className:` token to
    // find. The first argument must be a quoted tag, which is what keeps this
    // from matching every `...el(` in the tree and quietly weakening the gate.
    /\bel\(\s*['"`][a-zA-Z][\w-]*['"`]\s*,/g,
  ];
  for (const text of ALL_SRC) {
    for (const anchor of anchors) {
      anchor.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = anchor.exec(text)) !== null) addWindow(text, match.index + match[0].length);
    }
  }
  // index.html carries the boot splash, and its styles are INLINE in a
  // <style> block on purpose (it must paint before the module graph). So
  // index.html is both a definition site and a markup site for those classes.
  const html = readFileSync(path.join(REPO, 'index.html'), 'utf8');
  for (const match of html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) add(match[1]!);
  return out;
}

describe('no CSS class is defined but never carried by an element', () => {
  it('every selector class appears in markup, a className assignment, or classList', () => {
    const used = usedClasses();
    const defined = new Map<string, string[]>();
    for (const sheet of STYLESHEETS) {
      for (const cls of definedClasses(readFileSync(path.join(REPO, sheet), 'utf8'))) {
        const sites = defined.get(cls) ?? [];
        sites.push(sheet);
        defined.set(cls, sites);
      }
    }
    // index.html's inline <style>, with HTML comments stripped first: a
    // comment in index.html mentions the literal text "<style>" and would
    // otherwise be parsed as a stylesheet full of prose.
    const html = readFileSync(path.join(REPO, 'index.html'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '\n');
    for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      for (const cls of definedClasses(block[1]!)) {
        const sites = defined.get(cls) ?? [];
        sites.push('index.html <style>');
        defined.set(cls, sites);
      }
    }

    const orphans = [...defined.entries()]
      .filter(([cls]) => !used.has(cls))
      // A runtime-composed class is absent by construction, not by mistake.
      .filter(([cls]) => !RUNTIME_COMPOSED_CSS.some((prefix) => cls.startsWith(prefix)))
      .map(([cls, sites]) => `.${cls} (defined in ${[...new Set(sites)].join(', ')})`)
      .sort();

    expect(
      orphans,
      'these classes have rules but no element ever carries them, so the rules ' +
        'describe nothing. Either the markup that should use them is missing, or ' +
        'the rules are leftovers. Note that a renamed modifier looks exactly ' +
        'like this: check the class the code actually appends before deleting.',
    ).toEqual([]);
  });
});
