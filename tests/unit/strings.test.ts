/**
 * Proves the naming seam actually holds:
 *
 *  1. `t()` resolves ids through rulesets/classic/strings.json (not a copy
 *     baked into strings.ts), interpolates `{param}` placeholders, and
 *     throws rather than silently falling back on an unknown id or a
 *     missing param.
 *  2. `facilityName()` validates against the SAME ids `@/data/rulesets`
 *     already treats as authoritative (cities.json), and its TEXT comes
 *     from strings.json, not a hardcoded switch - proved by mocking the
 *     JSON table and watching the output move with the mock, the same
 *     technique tests/unit/calendar.cadence-not-hardcoded.test.ts uses for
 *     numbers. `cityName()` validates the same way but resolves through
 *     `citiesConfig()`'s own `name` field instead - strings.json used to
 *     carry a second, hand-copied `city.*` table with nothing checking the
 *     two agreed (see src/ui/strings.ts's header), so its sourcing proof
 *     mocks `@/data/rulesets` instead of strings.json.
 *  3. strings.ts fails fast at import time if a facility kind, a
 *     couriers.json refusal reason, or a HUD message kind ever lacks
 *     matching wording - proved by re-importing the module under a
 *     deliberately incomplete mock and watching it throw.
 *  4. No `src/ui/**\/*.ts` file - or src/app.ts, which builds the menus,
 *     status line and message log directly - hardcodes a display string
 *     outside the table. A small TypeScript-AST scanner (below) walks every
 *     such file for string literals in DOM-text positions (including
 *     `aria-label` attribute values, `+=` accumulation, and one hop of
 *     `const`/`let` variable indirection - see `collectLiteralPieces`) and
 *     fails the moment an unlisted one appears. Everything it currently
 *     finds in src/ui/builder.ts, a file this task does not own, is named
 *     in `EXISTING_VIOLATIONS` below with a reason; that allowlist is the
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

/** The raw strings.json table, read independently of `@/ui/strings`'s own import of it, so a test comparing against it is checking the DATA, not re-asking the implementation what it thinks the data says. */
function rawStringsTable(): Record<string, string> {
  const raw = readFileSync(resolve(PROJECT_ROOT, 'rulesets/classic/strings.json'), 'utf8');
  return (JSON.parse(raw) as { strings: Record<string, string> }).strings;
}

// ---------------------------------------------------------------------------
// 1. t(): lookup, interpolation, unknown id / missing param
// ---------------------------------------------------------------------------

describe('t(): typed lookup + interpolation over strings.json', () => {
  it('resolves a known id to strings.json\'s OWN current text for it (read independently of @/ui/strings), not a value copied into this test', () => {
    expect(t('facility.garage')).toBe(rawStringsTable()['facility.garage']);
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
  it('facilityName resolves every real facilityKinds entry to strings.json\'s OWN text for it, not just any non-throwing value', () => {
    // Comparing against a value read independently of @/ui/strings (see
    // rawStringsTable) is what makes this mutation-provable: a facilityName
    // hardcoded to always `return t('facility.garage')` still resolves
    // (doesn't throw) for every kind, but only matches THIS per-kind
    // expected value for kind === 'garage' - every other kind fails.
    const raw = rawStringsTable();
    for (const kind of citiesConfig().facilityKinds) {
      expect(facilityName(kind)).toBe(raw[`facility.${kind}`]);
    }
  });

  it('cityName resolves every real city id to that SAME city\'s own cities.json name, not just any non-throwing value', () => {
    // Same mutation-proofing as facilityName above, against cityName's own
    // source of truth (cities.json's `name` field - see this file's header,
    // item 2, on why that is cities.json and not strings.json).
    for (const city of citiesConfig().cities) {
      expect(cityName(city.id)).toBe(city.name);
    }
  });

  it('facilityName rejects a kind cities.json does not define', () => {
    expect(() => facilityName('nonexistent-kind')).toThrow(UnknownRulesetIdError);
  });

  it('cityName rejects an id cities.json does not define', () => {
    expect(() => cityName('nonexistent-city')).toThrow(UnknownRulesetIdError);
  });

  it('cityName\'s TEXT is read from cities.json\'s own `name` field (via citiesConfig()) at call time, not duplicated in strings.json', async () => {
    vi.resetModules();
    const MOCK_NAME = 'Mocked City Display Name (proves sourcing)';
    vi.doMock('@/data/rulesets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/data/rulesets')>();
      return {
        ...actual,
        citiesConfig: () => {
          const real = actual.citiesConfig();
          return {
            ...real,
            cities: real.cities.map((city) => (city.id === 'newyork' ? { ...city, name: MOCK_NAME } : city)),
          };
        },
      };
    });
    const fresh = await import('@/ui/strings');
    expect(fresh.cityName('newyork')).toBe(MOCK_NAME);
    // Sanity: a name NOT touched by the mock is unaffected, so this isn't
    // coincidentally passing because everything returns the same string.
    expect(fresh.cityName('boston')).toBe('Boston');
    vi.doUnmock('@/data/rulesets');
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

describe('assertStringCoverage(): fails fast when a ruleset gains an id strings.json has no wording for', () => {
  /**
   * `vi.resetModules()` gives each dynamic import below a fresh module
   * instance, so the class it throws is a distinct object from the
   * `MissingStringCoverageError` bound by the static import above -
   * `instanceof`/`toThrow(Ctor)` would fail on identity alone even though it
   * is "the same" error. Assert on name + message instead.
   */
  async function importStringsAndCatch(): Promise<unknown> {
    try {
      await import('@/ui/strings');
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it('throws when a real facilityKinds entry is missing from the mocked table', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      const strings = { ...actual.default.strings };
      delete strings['facility.garage']; // garage is a REAL cities.json facilityKinds entry
      return { default: { ...actual.default, strings } };
    });

    const caught = await importStringsAndCatch();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('MissingStringCoverageError');
    expect((caught as Error).message).toContain('facility.garage');

    vi.doUnmock('@rulesets/classic/strings.json');
    vi.resetModules();
  });

  /**
   * Regression for the defect this describe block used to have: it checked
   * ONLY facility/city ids, so a refusal reason added to couriers.json's
   * `refusalReasons` with no matching `refusal.<REASON>` wording produced no
   * failure anywhere - the miss would have surfaced as an
   * `UnknownStringIdError` thrown mid-interaction, from a module no caller
   * wraps in a try, the moment a player hit that exact refusal.
   */
  it('throws when a real couriers.json refusalReasons entry is missing from the mocked table', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      const strings = { ...actual.default.strings };
      delete strings['refusal.NO_ACTIVE_VEHICLE']; // a REAL couriers.json refusalReasons entry
      return { default: { ...actual.default, strings } };
    });

    const caught = await importStringsAndCatch();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('MissingStringCoverageError');
    expect((caught as Error).message).toContain('refusal.NO_ACTIVE_VEHICLE');

    vi.doUnmock('@rulesets/classic/strings.json');
    vi.resetModules();
  });

  it('throws when a real @/ui/hud HudMessageKind is missing from the mocked table', async () => {
    vi.resetModules();
    vi.doMock('@rulesets/classic/strings.json', async (importOriginal) => {
      const actual = await importOriginal<{ default: { strings: Record<string, string> } }>();
      const strings = { ...actual.default.strings };
      delete strings['event.victory']; // 'victory' is a REAL HudMessageKind (see @/ui/hud)
      return { default: { ...actual.default, strings } };
    });

    const caught = await importStringsAndCatch();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('MissingStringCoverageError');
    expect((caught as Error).message).toContain('event.victory');

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
 * text: `calleeName -> { index, minArgs? }` (`'last'` for the final
 * argument). `minArgs` guards a callee with more than one signature in play
 * - `src/ui/hud.ts`'s `el(doc, tag, attrs?, text?)` only carries text in its
 * 3rd/4th argument, but `src/app.ts` has its OWN, differently-shaped
 * `el(tag, className?, text?)` under the same name, whose 1- and 2-argument
 * calls (`el('canvas')`, `el('div', 'sm-screen')`) carry a tag or class name
 * in the "last" slot, not text - without `minArgs: 3` those read as
 * hardcoded display strings. `src/ui/builder.ts`'s `statRow(list, label,
 * value, invalid)` and `src/app.ts`'s `log`/`logMessage(kind, text)` are the
 * others in use today. Add an entry here if a future helper introduces
 * another one - the scanner only sees positions it's told about.
 */
interface TextArgSpec {
  readonly index: number | 'last';
  /** Skip this call entirely when it has fewer arguments than this. */
  readonly minArgs?: number;
}
const TEXT_ARG_CALLEES: Readonly<Record<string, TextArgSpec>> = {
  setText: { index: 0 },
  el: { index: 'last', minArgs: 3 },
  statRow: { index: 1 },
  log: { index: 1 },
  logMessage: { index: 1 },
};

/**
 * WebGPU (and small @/render wrapper) resource-descriptor calls whose
 * `label:` property is a GPU debug label surfaced only in a graphics
 * debugger (`GPUObjectDescriptorBase.label`), never in the game's UI. Every
 * WebGPU `create*` call and `beginRenderPass`/`beginComputePass` accepts one
 * this way - matched structurally (call name starts with `create`, or is a
 * `begin*Pass`) rather than one call at a time, so a new WebGPU resource
 * creation elsewhere in `src/app.ts` doesn't need a new entry here. This is
 * the one legitimate reason a `label:` property is exempt from
 * `TEXT_PROPERTY_NAMES` - `MenuAction.label` and builder.ts's row labels are
 * both still caught, because neither sits inside one of these calls.
 */
function isGpuDebugLabelProperty(node: ts.PropertyAssignment): boolean {
  if (!(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) || node.name.text !== 'label') return false;
  const objectLiteral = node.parent;
  if (!ts.isObjectLiteralExpression(objectLiteral)) return false;
  const call = objectLiteral.parent;
  if (!ts.isCallExpression(call) || !(call.arguments as readonly ts.Node[]).includes(objectLiteral)) return false;
  const calleeName = ts.isIdentifier(call.expression)
    ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : undefined;
  return calleeName !== undefined && (calleeName.startsWith('create') || calleeName.startsWith('begin'));
}

/**
 * Object-literal property names this codebase uses to carry display text
 * through a data structure before it reaches `.textContent` (e.g.
 * `rows.push({ label: 'Body', ... })` in builder.ts). Same extend-as-needed
 * contract as `TEXT_ARG_CALLEES` above.
 */
const TEXT_PROPERTY_NAMES: ReadonlySet<string> = new Set(['label', 'valueLabel', 'message', 'aria-label']);

/**
 * Binary operators through which either operand can end up as the run-time
 * value: `+` (concatenation), and the two "pick one side or the other"
 * fallback operators `??` and `||`. A hardcoded default hiding behind
 * `someValue ?? 'literal fallback'` is exactly as unenforced as one hiding
 * behind `+` - the scanner has to look down both branches of all three.
 */
function isTextCombiningOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PlusToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken ||
    kind === ts.SyntaxKind.BarBarToken
  );
}

/** True for a node kind that introduces its own variable scope, so identifier resolution should not walk past it outward without narrowing first. */
function isScopeBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isSourceFile(node)
  );
}

/**
 * Resolves a bare `Identifier` used in a literal-collecting position to its
 * nearest lexical `const`/`let`/`var` declaration, so `collectLiteralPieces`
 * can see through `const reason = 'literal'; ...message: reason` instead of
 * stopping at the bare `Identifier` (see this file's header, item 4, on why
 * that indirection used to defeat the scanner entirely).
 *
 * Scoped, not file-global: an EARLIER version of this scanner mapped every
 * `name -> initializer` once for the whole file, "last declaration wins".
 * That silently mis-resolved `src/ui/menu.ts`'s `activate()`, whose `const
 * reason = action.reason ?? ...` sits nowhere near `buildMenuDom()`'s
 * unrelated `const reason = document.createElement('span')` a hundred lines
 * later - the later, same-named DOM-element declaration overwrote the
 * former in the map, so a hardcoded fallback string one hop behind
 * `activate()`'s `reason` went unresolved (found empty, mutation-tested:
 * broke `t('ui.menu.actionUnavailable', ...)` back into a literal fallback
 * and the full-file scan still reported zero violations). This version
 * walks OUTWARD from the identifier's own use through enclosing scopes
 * (function bodies, then the module) and returns the first declaration
 * found in the nearest one that has it, matching where a real interpreter
 * would resolve the same name.
 */
function resolveIdentifierInitializer(identifier: ts.Identifier): ts.Expression | undefined {
  let scope: ts.Node = identifier;
  while (!isScopeBoundary(scope)) {
    scope = scope.parent;
  }
  for (;;) {
    let found: ts.Expression | undefined;
    function visit(node: ts.Node): void {
      if (found !== undefined) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === identifier.text &&
        node.initializer !== undefined
      ) {
        found = node.initializer;
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(scope);
    if (found !== undefined) return found;
    if (ts.isSourceFile(scope)) return undefined;
    scope = scope.parent;
    while (!isScopeBoundary(scope)) {
      scope = scope.parent;
    }
  }
}

/**
 * Collects non-empty literal text segments reachable from `node` through
 * ternaries, `+`/`??`/`||`, template literals, and ONE OR MORE hops of
 * `const`/`let` variable indirection resolved lexically (see
 * `resolveIdentifierInitializer`) - not through a call or property access,
 * which is exactly the line between "hardcoded" and "data-driven". `seen`
 * guards against a self- or mutually-referential binding recursing forever.
 */
function collectLiteralPieces(node: ts.Expression, acc: string[], seen: ReadonlySet<string> = new Set()): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    acc.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    acc.push(node.head.text);
    for (const span of node.templateSpans) {
      collectLiteralPieces(span.expression, acc, seen);
      acc.push(span.literal.text);
    }
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectLiteralPieces(node.whenTrue, acc, seen);
    collectLiteralPieces(node.whenFalse, acc, seen);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    collectLiteralPieces(node.expression, acc, seen);
    return;
  }
  if (ts.isBinaryExpression(node) && isTextCombiningOperator(node.operatorToken.kind)) {
    collectLiteralPieces(node.left, acc, seen);
    collectLiteralPieces(node.right, acc, seen);
    return;
  }
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const initializer = resolveIdentifierInitializer(node);
    if (initializer !== undefined) {
      collectLiteralPieces(initializer, acc, new Set(seen).add(node.text));
    }
    return;
  }
  // Calls, property access, numeric/boolean literals etc. carry no literal
  // text of their own at this position - not a hardcoded string.
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
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === 'textContent' || node.left.name.text === 'innerText')
    ) {
      const pieces: string[] = [];
      collectLiteralPieces(node.right, pieces);
      report(node.right, pieces);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const spec = TEXT_ARG_CALLEES[node.expression.text];
      if (spec !== undefined && node.arguments.length >= (spec.minArgs ?? 0)) {
        const arg = spec.index === 'last' ? node.arguments[node.arguments.length - 1] : node.arguments[spec.index];
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
      TEXT_PROPERTY_NAMES.has(node.name.text) &&
      !isGpuDebugLabelProperty(node)
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
  // app.ts builds menus, the status line and the message log directly (see
  // this file's header, item 4) - a scanner scoped to src/ui/ alone can
  // never see those hardcoded strings.
  out.push(resolve(PROJECT_ROOT, 'src/app.ts'));
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
 * Pre-existing hardcoded display strings in src/ui/builder.ts, a file this
 * task does not own (see YOUR FILES in the task brief). This is the honest
 * debt ledger, not a way to blind the scanner: every entry here is a real
 * violation, kept visible so a future migration phase has a checklist
 * instead of a silent pass. Matched by (file, text), not line number, so it
 * survives unrelated edits to the same file.
 *
 * hud.ts's OWN entries used to live here too - panel titles, the radar
 * offline/orientation strings, and the reduced-flash/reduced-shake toggle
 * text all had exact-match wording already sitting unused in
 * rulesets/classic/strings.json's ui.panel, ui.radar and ui.a11y sections
 * (see this file's header, item 1). They are wired through `t()` now, so
 * they are gone from both hud.ts's source and this ledger - not because the
 * scanner stopped looking, but because the violation no longer exists.
 * hud.ts's remaining entries below (radar contact-count summary, tire/plant/
 * driver-vitals labels, the ready/cooldown glyph swap, etc.) are real,
 * still-open debt: a larger set than builder.ts's, some of it interpolated
 * in ways `t()` doesn't need a new id for once a caller composes the pieces
 * (e.g. "Plant:" + damageLabel(...)) - left for the migration phase this
 * ledger exists to track, not folded into this task's scope.
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
    // Budget and Remaining are the other two halves of the same comparison.
    // Cost alone cannot be read as good or bad without them — a player had to
    // remember the balance from another screen, or exceed the limit to discover
    // it. Same statRow(label) family as the rest of the list, same exemption.
    ['src/ui/builder.ts', 'Budget'],
    ['src/ui/builder.ts', 'Remaining'],
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
    // src/ui/hud.ts - remaining status copy not wired through t() by this task
    ['src/ui/hud.ts', 'contacts, range'],
    ['src/ui/hud.ts', 'meters, oriented to'],
    ['src/ui/hud.ts', 'hostile'],
    ['src/ui/hud.ts', 'contact'],
    ['src/ui/hud.ts', '▲'],
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
    // src/app.ts - a WebGPU texture LABEL, not display text. It is passed as
    // the `label` field of a resource descriptor and only ever surfaces in a
    // GPU capture / validation message, never on screen. The scanner cannot
    // tell a label from copy because both are string literals in an object
    // literal, and putting a GPU-internal identifier in strings.json would be
    // worse: it would make a debug label look like translatable player-facing
    // text and put it in the localisation pipeline.
    ['src/app.ts', 'scene-color'],
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
