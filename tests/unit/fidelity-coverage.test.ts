/**
 * fidelity-notes.yaml is the project's provenance ledger and a release
 * gate: every gameplay constant in rulesets/classic/*.json is supposed to
 * carry an entry recording whether it is Exact / Observed / Reconstruction.
 * An integrator once claimed complete coverage while six constants
 * (arenas.houseVehicle.totalCount/salvageable and four
 * quests.the-boss-tape.onAccept/onDeliver flags) had none.
 *
 * This suite re-derives the required-entry set from the ruleset JSON files
 * themselves (not from the ledger, and not from any TS type) and fails
 * loudly if any gameplay number/boolean lacks a covering ledger entry. It
 * also parses fidelity-notes.yaml with a small purpose-built parser
 * (no `yaml` package is installed - see `hasYamlPackage` below) that
 * throws on any line shape it doesn't recognize, rather than silently
 * skipping it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RULESETS_DIR = fileURLToPath(new URL('../../rulesets/classic', import.meta.url));
const LEDGER_PATH = path.join(RULESETS_DIR, 'fidelity-notes.yaml');

// ---------------------------------------------------------------------------
// 1. A tiny, strict fidelity-notes.yaml parser.
//
// The file's shape is fixed and simple (see the header comment in the file
// itself): a top-level `entries:` line, then a flat list where every
// element is exactly five fields (value/status/source/confidence/note) in
// a fixed order, one per line, no nesting, no multi-line strings. Rather
// than pull in a YAML dependency for that, this walks it line-by-line and
// throws the moment a line doesn't match what it expects, so a future
// change to the file's shape breaks this loudly instead of the parser
// quietly dropping entries and the coverage check going blind.
// ---------------------------------------------------------------------------

interface LedgerEntry {
  id: string;
  status: string;
  line: number;
  /**
   * The `value:` field, as the RAW source text.
   *
   * It was parsed by `FIELD_RE` (so a malformed line still throws) and then
   * discarded, which made all 965 recorded values decorative: editing a
   * ruleset number without touching the ledger left the provenance gate green.
   * Measured — `arenas._reconstruction.escapePrestigePenalty` changed from 1
   * to 999 (a 999x change to a Reconstruction constant) and
   * `fidelity-coverage.test.ts` reported 7/7 green.
   *
   * Kept as raw text rather than a parsed number because a ledger value may
   * legitimately be a quoted string or a YAML-ish list; `valuesAgree` below is
   * the only place that decides what counts as equal, and it compares parsed
   * values so `1` and `1.0` do not register as a mismatch.
   */
  valueText: string;
}

function parseFidelityLedger(text: string): LedgerEntry[] {
  const lines = text.split('\n');
  const entriesLineIndex = lines.findIndex((l) => l.trim() === 'entries:');
  if (entriesLineIndex === -1) {
    throw new Error("fidelity-notes.yaml parser: no top-level 'entries:' line found");
  }

  const entries: LedgerEntry[] = [];
  let i = entriesLineIndex + 1;
  // Order matters: these must appear in exactly this sequence after each id line.
  const FIELD_ORDER = ['value', 'status', 'source', 'confidence', 'note'] as const;
  const FIELD_RE: Record<(typeof FIELD_ORDER)[number], RegExp> = {
    value: /^ {4}value: .*$/,
    status: /^ {4}status: (Exact|Observed|Reconstruction)$/,
    source: /^ {4}source: ".*"$/,
    confidence: /^ {4}confidence: [0-9]+(\.[0-9]+)?$/,
    note: /^ {4}note: ".*"$/,
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const idMatch = line.match(/^ {2}- id: "(.*)"$/);
    if (!idMatch || typeof idMatch[1] !== 'string') {
      throw new Error(
        `fidelity-notes.yaml parser: expected an '  - id: "..."' line at line ${i + 1}, got: ${JSON.stringify(line)}`,
      );
    }
    const id = idMatch[1];
    const idLine = i + 1;
    i += 1;

    let status = '';
    let valueText = '';
    for (const field of FIELD_ORDER) {
      const re = FIELD_RE[field];
      const fieldLine = lines[i];
      const fieldMatch = fieldLine === undefined ? null : fieldLine.match(re);
      if (!fieldMatch) {
        throw new Error(
          `fidelity-notes.yaml parser: entry "${id}" (starting line ${idLine}) expected a '${field}:' line ` +
            `matching ${re} at line ${i + 1}, got: ${JSON.stringify(fieldLine)}`,
        );
      }
      if (field === 'status' && typeof fieldMatch[1] === 'string') {
        status = fieldMatch[1];
      }
      if (field === 'value' && fieldLine !== undefined) {
        // Strip the 4-space indent and the `value: ` key, then trailing space.
        valueText = fieldLine.slice('    value: '.length).trim();
      }
      i += 1;
    }

    entries.push({ id, status, line: idLine, valueText });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 2. A generic walker over the ruleset JSON that enumerates every leaf
//    number/boolean that feeds simulation math, computing the ledger id(s)
//    that would cover it.
//
// The ledger's own id convention turns out to have one inconsistency: for
// most files, a top-level array whose key equals the file's own stem
// collapses (e.g. bodies.json's top-level "bodies" array yields ids like
// "bodies.compact.price", not "bodies.bodies.compact.price"), but for
// cities.json and quests.json it does not collapse (ids like
// "cities.cities.newyork.x" and "quests.quests.the-boss-tape.gate").
// Rather than special-case those two files by name, this computes BOTH
// candidate spellings for every constant and accepts either being present
// in the ledger - a constant is only reported missing if NEITHER spelling
// has an entry. This was verified against the ledger as it stood before
// this fix: it reproduces exactly the six known-missing constants and zero
// false positives (every other ledger id matches one of the two spellings
// for some real constant, or is one of the pre-existing non-numeric extras
// documented below).
// ---------------------------------------------------------------------------

interface RequiredConstant {
  file: string;
  /** Path segments from the JSON root, with array items identified by their own "id" field when present, else their index. */
  path: string[];
  candidateIds: string[];
  /**
   * The value this constant currently holds in the ruleset JSON.
   *
   * Present so the ledger's recorded `value:` can be COMPARED against reality.
   * For a bare array documented as one combined constant this is the whole
   * array, which is the ledger's own convention for those entries.
   */
  value: unknown;
}

/**
 * Explicit, commented exclusion list for keys that are never a fidelity
 * constant even when their value happens to be a number or boolean.
 * Everything else numeric/boolean is in scope by default - nothing is
 * excluded silently.
 */
const EXCLUDED_KEYS = new Set([
  '$schemaVersion', // file format version tag, not a gameplay number
]);

/**
 * Path-shaped exclusions that can't be expressed as a bare key name
 * because the key ("x"/"y") isn't unique to this one meaning.
 */
function isExcludedPath(file: string, path: string[]): boolean {
  // cities.json's per-city "x"/"y" are normalized map-layout coordinates
  // for rendering the city map, not a value any simulation formula reads.
  if (file === 'cities' && path[0] === 'cities' && path.length === 3 && (path[2] === 'x' || path[2] === 'y')) {
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function candidateIdsFor(file: string, path: string[]): string[] {
  const uncollapsed = [file, ...path].join('.');
  const collapsed = path[0] === file ? [file, ...path.slice(1)].join('.') : uncollapsed;
  return collapsed === uncollapsed ? [uncollapsed] : [collapsed, uncollapsed];
}

function walk(file: string, node: unknown, path: string[], out: RequiredConstant[]): void {
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (EXCLUDED_KEYS.has(key)) continue;
      walk(file, value, [...path, key], out);
    }
    return;
  }

  if (Array.isArray(node)) {
    if (node.length === 0) return;
    const allPrimitive = node.every((item) => !isPlainObject(item));
    if (allPrimitive) {
      // A bare array of numbers/booleans/strings (e.g. prestigeGates,
      // salvageSkillGainWeights, allowedFacings) is documented as ONE
      // combined constant, matching the ledger's existing convention.
      if (node.some((item) => typeof item === 'number' || typeof item === 'boolean')) {
        if (!isExcludedPath(file, path)) out.push({ file, path, candidateIds: candidateIdsFor(file, path), value: node });
      }
      return;
    }
    node.forEach((item, index) => {
      const segment = isPlainObject(item) && typeof item.id === 'string' ? item.id : String(index);
      walk(file, item, [...path, segment], out);
    });
    return;
  }

  if (typeof node === 'number' || typeof node === 'boolean') {
    if (!isExcludedPath(file, path)) out.push({ file, path, candidateIds: candidateIdsFor(file, path), value: node });
  }
  // strings, null, undefined: not a fidelity constant, ignored.
}

function loadRulesetFiles(): { file: string; data: unknown }[] {
  return readdirSync(RULESETS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      file: name.replace(/\.json$/, ''),
      data: JSON.parse(readFileSync(path.join(RULESETS_DIR, name), 'utf8')),
    }));
}

function findRequiredConstants(): RequiredConstant[] {
  const out: RequiredConstant[] = [];
  for (const { file, data } of loadRulesetFiles()) {
    walk(file, data, [], out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fidelity-notes.yaml parser', () => {
  it('parses the real ledger without error and finds a substantial number of entries', () => {
    const text = readFileSync(LEDGER_PATH, 'utf8');
    const entries = parseFidelityLedger(text);
    expect(entries.length).toBeGreaterThan(600);
  });

  it('throws loudly on a shape it does not understand, instead of silently skipping', () => {
    const malformed = [
      'entries:',
      '  - id: "some.constant"',
      '    value: 1',
      '    status: Exact',
      '    source: "test"',
      // missing confidence/note lines entirely - not a recognized shape
    ].join('\n');
    expect(() => parseFidelityLedger(malformed)).toThrow();
  });

  it('throws on an unrecognized status value rather than accepting it silently', () => {
    const malformed = [
      'entries:',
      '  - id: "some.constant"',
      '    value: 1',
      '    status: TotallyMadeUp',
      '    source: "test"',
      '    confidence: 0.5',
      '    note: "test"',
    ].join('\n');
    expect(() => parseFidelityLedger(malformed)).toThrow();
  });

  it('every ledger entry has one of the three documented statuses', () => {
    const text = readFileSync(LEDGER_PATH, 'utf8');
    const entries = parseFidelityLedger(text);
    for (const entry of entries) {
      expect(['Exact', 'Observed', 'Reconstruction']).toContain(entry.status);
    }
  });

  it('has no duplicate ids', () => {
    const text = readFileSync(LEDGER_PATH, 'utf8');
    const entries = parseFidelityLedger(text);
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const entry of entries) {
      if (seen.has(entry.id)) {
        duplicates.push(`"${entry.id}" (lines ${seen.get(entry.id)} and ${entry.line})`);
      } else {
        seen.set(entry.id, entry.line);
      }
    }
    expect(duplicates).toEqual([]);
  });
});

describe('fidelity-notes.yaml coverage', () => {
  it('walker sanity check: finds a substantial number of required constants', () => {
    // Guards against the walker itself regressing to "finds nothing", which
    // would make the coverage assertion below pass vacuously.
    expect(findRequiredConstants().length).toBeGreaterThan(600);
  });

  it('every gameplay number/boolean in rulesets/classic/*.json has a fidelity-notes.yaml entry', () => {
    const ledgerText = readFileSync(LEDGER_PATH, 'utf8');
    const ledgerIds = new Set(parseFidelityLedger(ledgerText).map((e) => e.id));

    const missing = findRequiredConstants().filter(
      (constant) => !constant.candidateIds.some((id) => ledgerIds.has(id)),
    );

    if (missing.length > 0) {
      const details = missing
        .map((m) => `  - ${m.file}.json: ${m.path.join('.')} (expected one of: ${m.candidateIds.join(' | ')})`)
        .join('\n');
      throw new Error(
        `${missing.length} gameplay constant(s) in rulesets/classic/*.json have no fidelity-notes.yaml entry:\n${details}`,
      );
    }
  });

  it("every ledger entry's recorded value MATCHES the value the ruleset actually holds", () => {
    // The gate above proves a constant has an entry. This proves the entry
    // still describes it.
    //
    // Without it, `value:` was parsed by the strict parser (so a malformed line
    // threw) and then thrown away, which made all 965 recorded values
    // decorative. Measured: changing
    // `arenas._reconstruction.escapePrestigePenalty` from 1 to 999 — a 999x
    // change to a Reconstruction constant, the exact thing this ledger exists
    // to make reviewable — left this whole file reporting 7/7 green.
    //
    // A provenance ledger that records a value it never checks is worse than no
    // ledger, because it reads as maintained.
    const ledger = parseFidelityLedger(readFileSync(LEDGER_PATH, 'utf8'));
    const byId = new Map(ledger.map((e) => [e.id, e]));

    // Map each JSON constant to whichever of its candidate spellings the
    // ledger actually used, so the comparison is against the entry that claims
    // this constant rather than an arbitrary one of the two spellings.
    const mismatches: string[] = [];
    let compared = 0;

    for (const constant of findRequiredConstants()) {
      const matchedId = constant.candidateIds.find((id) => byId.has(id));
      const entry = matchedId === undefined ? undefined : byId.get(matchedId);
      if (entry === undefined) continue; // no entry at all — the gate above reports it

      if (!recordedValueMatches(entry.valueText, constant.value)) {
        mismatches.push(
          `  - ${matchedId}\n      ledger records: ${entry.valueText}\n      ${constant.file}.json holds: ${JSON.stringify(constant.value)}`,
        );
      }
      compared += 1;
    }

    // A comparison that silently matched nothing would pass vacuously, which
    // is the failure this repo has a documented habit of. So the count is
    // asserted, not just the mismatch list.
    expect(compared).toBeGreaterThan(900);

    if (mismatches.length > 0) {
      throw new Error(
        `${mismatches.length} fidelity-notes.yaml value(s) disagree with the ruleset. Either the constant ` +
          `changed without its provenance being revisited, or the ledger was not regenerated:\n${mismatches.join('\n')}`,
      );
    }
  });
});

/**
 * Does a ledger `value:` line describe this JSON value?
 *
 * The ledger stores raw text (`1`, `true`, `[20, 40, 60, 80, 95]`, or a quoted
 * string), while the JSON holds a parsed value, so the comparison is on PARSED
 * values rather than on string equality — otherwise `1` vs `1.0` and `true` vs
 * `"true"` would both read as drift on entries nobody touched.
 */
function recordedValueMatches(valueText: string, actual: unknown): boolean {
  const parseRecorded = (): unknown => {
    const trimmed = valueText.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) return Number(trimmed);
    if (/^null$/.test(trimmed)) return null;
    // A bracketed list, possibly with trailing junk the generator appended.
    const bracket = trimmed.match(/^\[([^\]]*)\]/);
    if (bracket !== null && typeof bracket[1] === 'string') {
      const inner = bracket[1].trim();
      if (inner === '') return [];
      return inner.split(',').map((part) => {
        const p = part.trim();
        if (p === 'true') return true;
        if (p === 'false') return false;
        const n = Number(p);
        return p !== '' && Number.isFinite(n) ? n : p;
      });
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  const recorded = parseRecorded();

  const deepEqual = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ak = Object.keys(a).sort();
      const bk = Object.keys(b).sort();
      return ak.length === bk.length && ak.every((k, i) => k === bk[i]) && ak.every((k) => deepEqual(a[k], b[k]));
    }
    return a === b;
  };

  if (deepEqual(recorded, actual)) return true;

  // A few ledger entries are recorded as a quoted JSON fragment of a scalar
  // that the JSON holds as a plain value, and vice versa. Comparing a string
  // against its own parsed form is not drift.
  if (typeof actual === 'string' && actual === valueText) return true;
  if (typeof actual === 'number' && typeof recorded === 'string' && Number(recorded) === actual) return true;

  return false;
}
