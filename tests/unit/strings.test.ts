/**
 * Proves the naming seam actually holds:
 *
 *  1. `t()` resolves ids through rulesets/classic/strings.json (not a copy
 *     baked into strings.ts), interpolates `{param}` placeholders, and
 *     throws rather than silently falling back on an unknown id or a
 *     missing param.
 *  2. `facilityName()` / `cityName()` validate against the SAME ids
 *     `@/data/rulesets` already treats as authoritative (cities.json), and
 *     their TEXT comes from strings.json, not a hardcoded switch - proved by
 *     mocking the JSON table and watching the output move with the mock,
 *     the same technique tests/unit/calendar.cadence-not-hardcoded.test.ts
 *     uses for numbers.
 *  3. strings.ts fails fast at import time if a facility kind or city id
 *     ever lacks matching wording - proved by re-importing the module under
 *     a deliberately incomplete mock and watching it throw.
 *  4. No `src/ui/**\/*.ts` file hardcodes a display string outside the
 *     table - a small TypeScript-AST scanner (below) walks every UI file
 *     for string literals in DOM-text positions and fails the moment an
 *     unlisted one appears. Everything it currently finds in files this
 *     task does not own (hud.ts, builder.ts) is named in
 *     `EXISTING_VIOLATIONS` below with a reason; that allowlist is the
 *     honest debt ledger for a later migration phase, not a way to blind
 *     the scanner.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { MissingStringParamError, UnknownStringIdError, cityName, facilityName, t } from '@/ui/strings';
import { UnknownRulesetIdError, citiesConfig } from '@/data/rulesets';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------------------
// 1. t(): lookup, interpolation, unknown id / missing param
// ---------------------------------------------------------------------------

describe('t(): typed lookup + interpolation over strings.json', () => {
  it('resolves a known id to its strings.json text', () => {
    expect(t('facility.garage')).toBe('Garage');
  });

  it('substitutes every {param} placeholder', () => {
    expect(t('ui.menu.actionUnavailable', { label: 'Repair' })).toBe('Repair is not available right now');
  });

  it('throws UnknownStringIdError instead of returning the raw id', () => {
    // @ts-expect-error - deliberately an id that does not exist, to exercise the runtime guard
    expect(() => t('does.not.exist')).toThrow(UnknownStringIdError);
  });

  it('throws MissingStringParamError instead of leaving "{label}" in the output', () => {
    expect(() => t('ui.menu.actionUnavailable')).toThrow(MissingStringParamError);
  });
});

// ---------------------------------------------------------------------------
// 2. facilityName / cityName: id validity + text sourced from strings.json
// ---------------------------------------------------------------------------

describe('facilityName() / cityName(): validate against cities.json, resolve through strings.json', () => {
  it('facilityName resolves every real facilityKinds entry', () => {
    for (const kind of citiesConfig().facilityKinds) {
      expect(() => facilityName(kind)).not.toThrow();
    }
  });

  it('cityName resolves every real city id', () => {
    for (const city of citiesConfig().cities) {
      expect(() => cityName(city.id)).not.toThrow();
    }
  });

  it('facilityName rejects a kind cities.json does not define', () => {
    expect(() => facilityName('nonexistent-kind')).toThrow(UnknownRulesetIdError);
  });

  it('cityName rejects an id cities.json does not define', () => {
    expect(() => cityName('nonexistent-city')).toThrow(UnknownRulesetIdError);
  });

  it('cityName\'s TEXT is read from strings.json at call time, not hardcoded in strings.ts', async () => {
    vi.resetModules();
    const MOCK_NAME = 'Mocked City Display Name (proves sourcing)';
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      return {
        default: { ...actual.default, strings: { ...actual.default.strings, 'city.newyork': MOCK_NAME } },
      };
    });
    const fresh = await import('@/ui/strings');
    expect(fresh.cityName('newyork')).toBe(MOCK_NAME);
    // Sanity: a name NOT touched by the mock is unaffected, so this isn't
    // coincidentally passing because everything returns the same string.
    expect(fresh.cityName('boston')).toBe('Boston');
    vi.doUnmock('@rulesets/classic/strings.json');
    vi.resetModules();
  });

  it('facilityName\'s TEXT is read from strings.json at call time, not hardcoded in strings.ts', async () => {
    vi.resetModules();
    const MOCK_NAME = 'Mocked Facility Display Name (proves sourcing)';
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      return {
        default: { ...actual.default, strings: { ...actual.default.strings, 'facility.garage': MOCK_NAME } },
      };
    });
    const fresh = await import('@/ui/strings');
    expect(fresh.facilityName('garage')).toBe(MOCK_NAME);
    expect(fresh.facilityName('bar')).toBe('Bar');
    vi.doUnmock('@rulesets/classic/strings.json');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// 3. Coverage guard: throws at import time on an incomplete table
// ---------------------------------------------------------------------------

describe('assertStringCoverage(): fails fast on a facility/city id with no wording', () => {
  it('importing strings.ts throws MissingStringCoverageError when a real city id is missing from the mocked table', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      const strings = { ...actual.default.strings };
      delete strings['city.newyork']; // newyork is a REAL cities.json id - the table is now incomplete
      return { default: { ...actual.default, strings } };
    });

    // `vi.resetModules()` gives this dynamic import a fresh module instance,
    // so the class it throws is a distinct object from the
    // `MissingStringCoverageError` bound by the static import above -
    // `instanceof`/`toThrow(Ctor)` would fail on identity alone even though
    // it is "the same" error. Assert on name + message instead.
    let caught: unknown;
    try {
      await import('@/ui/strings');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('MissingStringCoverageError');
    expect((caught as Error).message).toContain('city.newyork');

    vi.doUnmock('@rulesets/classic/strings.json');
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// 4. Scanner: no hardcoded display string in src/ui/**/*.ts outside the table
// ---------------------------------------------------------------------------

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Call sites this codebase currently uses to construct visible label/button
 * text: `calleeName -> argument index ('last' for the final argument)`.
 * `src/ui/hud.ts`'s `el(doc, tag, attrs?, text?)` and `src/ui/builder.ts`'s
 * `statRow(list, label, value, invalid)` are the two in use today. Add an
 * entry here if a future helper introduces another one - the scanner only
 * sees positions it's told about.
 */
const TEXT_ARG_CALLEES: Readonly<Record<string, number | 'last'>> = {
  setText: 0,
  el: 'last',
  statRow: 1,
};

/**
 * Object-literal property names this codebase uses to carry display text
 * through a data structure before it reaches `.textContent` (e.g.
 * `rows.push({ label: 'Body', ... })` in builder.ts). Same extend-as-needed
 * contract as `TEXT_ARG_CALLEES` above.
 */
const TEXT_PROPERTY_NAMES: ReadonlySet<string> = new Set(['label', 'valueLabel', 'message']);

/** Collects non-empty literal text segments directly reachable from `node` through ternaries, string concatenation and template literals - not through a variable, call or property access, which is exactly the line between "hardcoded" and "data-driven". */
function collectLiteralPieces(node: ts.Expression, acc: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    acc.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    acc.push(node.head.text);
    for (const span of node.templateSpans) {
      collectLiteralPieces(span.expression, acc);
      acc.push(span.literal.text);
    }
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectLiteralPieces(node.whenTrue, acc);
    collectLiteralPieces(node.whenFalse, acc);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    collectLiteralPieces(node.expression, acc);
    return;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collectLiteralPieces(node.left, acc);
    collectLiteralPieces(node.right, acc);
    return;
  }
  // Identifiers, calls, property access, numeric/boolean literals etc. carry
  // no literal text of their own at this position - not a hardcoded string.
}

function scanUiFile(absPath: string, relPath: string): Violation[] {
  const sourceText = readFileSync(absPath, 'utf8');
  const source = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];

  function report(anchor: ts.Node, pieces: readonly string[]): void {
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (trimmed.length === 0) continue;
      const { line } = source.getLineAndCharacterOfPosition(anchor.getStart(source));
      violations.push({ file: relPath, line: line + 1, text: trimmed });
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === 'textContent' || node.left.name.text === 'innerText')
    ) {
      const pieces: string[] = [];
      collectLiteralPieces(node.right, pieces);
      report(node.right, pieces);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const argIndex = TEXT_ARG_CALLEES[node.expression.text];
      if (argIndex !== undefined) {
        const arg = argIndex === 'last' ? node.arguments[node.arguments.length - 1] : node.arguments[argIndex];
        if (arg) {
          const pieces: string[] = [];
          collectLiteralPieces(arg, pieces);
          report(arg, pieces);
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      TEXT_PROPERTY_NAMES.has(node.name.text)
    ) {
      const pieces: string[] = [];
      collectLiteralPieces(node.initializer, pieces);
      report(node.initializer, pieces);
    }

    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

function listUiFiles(): readonly string[] {
  const root = resolve(PROJECT_ROOT, 'src/ui');
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (extname(entry.name) === '.ts' && entry.name !== 'strings.ts') {
        out.push(abs);
      }
    }
  }
  walk(root);
  return out;
}

function scanAll(): Violation[] {
  const violations: Violation[] = [];
  for (const abs of listUiFiles()) {
    violations.push(...scanUiFile(abs, relative(PROJECT_ROOT, abs)));
  }
  return violations;
}

/**
 * Pre-existing hardcoded display strings in files this task does not own
 * (src/ui/hud.ts, src/ui/builder.ts - see YOUR FILES in the task brief).
 * This is the honest debt ledger, not a way to blind the scanner: every
 * entry here is a real violation, kept visible so a future migration phase
 * has a checklist instead of a silent pass. Matched by (file, text), not
 * line number, so it survives unrelated edits to the same file.
 */
const EXISTING_VIOLATIONS: ReadonlySet<string> = new Set(
  [
    // src/ui/builder.ts - row labels for the vehicle builder's spec sheet
    ['src/ui/builder.ts', 'Name'],
    ['src/ui/builder.ts', 'Body'],
    ['src/ui/builder.ts', 'Chassis'],
    ['src/ui/builder.ts', 'Suspension'],
    ['src/ui/builder.ts', 'Power Plant'],
    ['src/ui/builder.ts', 'Tires'],
    ['src/ui/builder.ts', 'Facing'],
    ['src/ui/builder.ts', 'Ammo'],
    ['src/ui/builder.ts', 'Confirm'],
    ['src/ui/builder.ts', '(unnamed)'],
    ['src/ui/builder.ts', 'Build this vehicle'],
    ['src/ui/builder.ts', 'Armor:'],
    ['src/ui/builder.ts', 'Weapon'],
    ['src/ui/builder.ts', '(empty)'],
    ['src/ui/builder.ts', '/'],
    // src/ui/builder.ts - validation/legality messages
    ['src/ui/builder.ts', 'car name is required'],
    ['src/ui/builder.ts', 'name is'],
    ['src/ui/builder.ts', 'characters, over the'],
    ['src/ui/builder.ts', '-character limit'],
    ['src/ui/builder.ts', '"'],
    ['src/ui/builder.ts', '" is already in your fleet'],
    ['src/ui/builder.ts', 'fleet already has'],
    ['src/ui/builder.ts', 'cars (max'],
    ['src/ui/builder.ts', ')'],
    // src/ui/builder.ts - stat-sheet row labels (statRow(list, label, value, invalid))
    ['src/ui/builder.ts', 'Cost'],
    ['src/ui/builder.ts', 'Weight'],
    ['src/ui/builder.ts', 'Spaces'],
    ['src/ui/builder.ts', 'Top Speed'],
    ['src/ui/builder.ts', 'Acceleration'],
    ['src/ui/builder.ts', 'Handling Class'],
    ['src/ui/builder.ts', 'Armor Total'],
    ['src/ui/builder.ts', 'Battery'],
    // src/ui/builder.ts - panel copy
    ['src/ui/builder.ts', '↑↓ select row · ←→ change · 0-9 type value · Enter confirm'],
    ['src/ui/builder.ts', 'Legality'],
    ['src/ui/builder.ts', 'No violations — ready to build.'],
    // src/ui/hud.ts - panel titles and status copy built through the el() helper
    ['src/ui/hud.ts', 'Weapons'],
    ['src/ui/hud.ts', 'Radar'],
    ['src/ui/hud.ts', 'Condition'],
    ['src/ui/hud.ts', '✕ RADAR OFFLINE — plant damaged'],
    ['src/ui/hud.ts', 'contacts, range'],
    ['src/ui/hud.ts', 'meters, oriented to'],
    ['src/ui/hud.ts', 'hostile'],
    ['src/ui/hud.ts', 'contact'],
    ['src/ui/hud.ts', '▲'],
    ['src/ui/hud.ts', 'Orientation: heading-up'],
    ['src/ui/hud.ts', 'Orientation: north-up'],
    ['src/ui/hud.ts', 'mph'],
    ['src/ui/hud.ts', 'mi'],
    ['src/ui/hud.ts', '0%'],
    ['src/ui/hud.ts', '● READY'],
    ['src/ui/hud.ts', '◔'],
    ['src/ui/hud.ts', '%'],
    ['src/ui/hud.ts', ':'],
    ['src/ui/hud.ts', 'Plant:'],
    ['src/ui/hud.ts', 'Driver:'],
    ['src/ui/hud.ts', 'Body armor:'],
    ['src/ui/hud.ts', 'Reduced flash: on'],
    ['src/ui/hud.ts', 'Reduced flash: off'],
    ['src/ui/hud.ts', 'Reduced shake: on'],
    ['src/ui/hud.ts', 'Reduced shake: off'],
  ].map(([file, text]) => `${file}\u0000${text}`),
);

describe('scanner: no UI file hardcodes display text outside rulesets/classic/strings.json', () => {
  it('every string literal in a DOM-text position is either absent or on the explicit allowlist', () => {
    const found = scanAll();
    const unlisted = found.filter((v) => !EXISTING_VIOLATIONS.has(`${v.file}\u0000${v.text}`));
    if (unlisted.length > 0) {
      const report = unlisted.map((v) => `  ${v.file}:${v.line}  ${JSON.stringify(v.text)}`).join('\n');
      throw new Error(
        `${unlisted.length} hardcoded UI string(s) not in strings.json and not on the allowlist:\n${report}`,
      );
    }
    expect(unlisted).toEqual([]);
  });
});
