/**
 * Every ruleset key must be read by production code, or be on a reviewed
 * allowlist that says why not.
 *
 * `rulesets` (every .json under it) is validated on load, so a key nobody
 * reads passes every gate in this repo: ajv is happy, `tsc` is happy, and the
 * value reads as authoritative. That is the shape worth catching.
 * `economy.json` held
 * eleven `timeCostDays` entries with no read site while `sim/types.ts` named
 * all sixteen in a union and `data/schema.ts` listed all sixteen as required
 * - so the data looked wired at three separate layers.
 *
 * THE TRAP IN FIXING THIS BY WIRING THE KEYS. `applyService` (sim/economy.ts)
 * already advances the clock by `service.days`, and `services[].days` agrees
 * with `timeCostDays[...]` for every service-backed action - verified equal
 * for all six: recharge 0, bus 1, cloneOrUpdate 1, healOnePoint 7,
 * buyBodyArmor 0, mechanicLesson 5. Adding `timeCostOf('bus')` to the bus
 * action as well would charge the day TWICE for one action. These are
 * redundant declarations, not missing code, and the fix is to record that
 * rather than to call them.
 *
 * Read detection covers the four idioms this codebase actually uses, because
 * a naive property-access scan reported 374 unread keys out of ~700, almost
 * all of them `strings.json` entries that are read as string ARGUMENTS to
 * `t('ui.hud.weaponFacing')`:
 *
 *   1. property access      `economy().services[...].price`
 *   2. literal subscript    `rarity['epic']`
 *   3. string argument      `timeCostOf('repairCar')`, `t('ui.phase.DAY')`
 *   4. dynamic subscript    `championships.firstDay[cityId]`, `poker[rank]`,
 *                           `services[serviceId]`, `factionWeights[id]`
 *
 * Form 4 is the one a name-based scan cannot resolve, so it is resolved
 * structurally: if a key's PARENT is subscripted somewhere, the parent is a
 * keyed table and the key is read by construction. That is why
 * `championships.firstDay.boston` is not reported despite the literal string
 * "boston" appearing nowhere in src.
 *
 * strings.json is INCLUDED, deliberately. `assertStringCoverage()` in
 * @/ui/strings checks the opposite direction - a new ruleset id with no
 * wording - so an unused string is not covered anywhere.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const RULESET_DIRS = ['rulesets/classic', 'rulesets/arcade'] as const;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.shots', '.playwright-mcp']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const blank = (match: string): string => match.replace(/[^\n]/g, ' ');

interface SourceLine {
  readonly file: string;
  readonly text: string;
}

/**
 * Files whose occurrences of a ruleset key are DECLARATIONS, not reads.
 *
 * `sim/types.ts` is the hand-written mirror of the ruleset shapes and
 * `data/schema.ts` is the ajv mirror; a key named in either has been declared
 * and validated, which is exactly the condition this gate exists to catch -
 * so counting those occurrences as "a reader" is what let fourteen dead keys
 * look wired at two separate layers.
 */
const DECLARATION_FILES = new Set(['src/sim/types.ts', 'src/data/schema.ts', 'src/persist/schema.ts']);

/** Production src, comments blanked but line numbers preserved. */
const SOURCE_LINES: readonly SourceLine[] = sourceFiles('src').flatMap((file) =>
  readFileSync(path.join(REPO, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/.*$/gm, blank)
    .split('\n')
    .map((text) => ({ file, text })),
);
const SOURCE_TEXT = SOURCE_LINES.map((l) => l.text).join('\n');

/**
 * Lines that may count as a READER. Occurrences in these three files are
 * shape declarations, not consumption, so they are dropped from the corpus
 * before the per-key test runs.
 */
const READER_LINES: readonly SourceLine[] = SOURCE_LINES.filter(
  (l) => !DECLARATION_FILES.has(l.file),
);
/**
 * token -> the reader lines containing it, built once.
 *
 * The first version of this gate ran every key against all ~20k reader lines,
 * rebuilding five RegExp objects per line, and took 4.7s against a 5s test
 * timeout - a gate that is one slow machine away from being skipped is not a
 * gate. Tokenising each line once makes the per-key cost proportional to the
 * handful of lines that actually mention the key, and cannot change a verdict:
 * a line cannot contain a token that is not in the index.
 */
const LINE_INDEX: ReadonlyMap<string, readonly SourceLine[]> = (() => {
  const index = new Map<string, SourceLine[]>();
  for (const line of READER_LINES) {
    for (const token of line.text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const list = index.get(token);
      if (list === undefined) index.set(token, [line]);
      else list.push(line);
    }
  }
  return index;
})();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (token: string): RegExp => new RegExp(`(?<![\\w$])${escape(token)}(?![\\w$])`);

/**
 * True when this line READS `token` rather than merely declaring its shape.
 *
 * A ruleset key is named in three kinds of place, and only the first is a
 * consumer:
 *   - a value read          `drivingConfig().radar.visualRangeM * ...`
 *   - an interface field    `readonly damageSkillDivisor: number;`
 *   - an ajv shape          `damageSkillDivisor: NON_NEG_NUM,`
 *   - an ajv required entry `'damageSkillDivisor',` / `required: ['a', 'b']`
 *
 * A `name: value` lead-in is deliberately NOT treated as a declaration: that
 * shape is an object literal far more often than it is a type, and
 * `cash: economy().startingCash,` in sim/driver.ts is a real read of
 * `startingCash`. Interface fields in `sim/types.ts` and `data/schema.ts` are
 * removed by DECLARATION_FILES instead, and the locally-compiled ajv shapes in
 * sim/road.ts and sim/arena.ts by the `{ type:` check.
 *
 * Counting the last three as a reader is precisely what made fourteen dead
 * keys look wired: they were named in `sim/types.ts` AND in
 * `data/schema.ts`, two independent layers, and neither consumes a value.
 */
function isReadLine(line: string, token: string): boolean {
  const re = word(token);
  re.lastIndex = 0;
  if (!re.test(line)) return false;
  const trimmed = line.trim();
  const bare = new RegExp(`^(readonly\\s+)?['"]?${escape(token)}['"]?\\s*[:,]?\\s*[;,]?$`);
  if (bare.test(trimmed)) return false;                                          // `K,` / `'K',`
  if (new RegExp(`^(readonly\\s+)?${escape(token)}\\s*:`).test(trimmed)) return false; // `K: shape,`
  if (/\brequired\s*:/.test(line)) return false;                                // required-list
  if (new RegExp(`[:{,]\\s*['"]?${escape(token)}['"]?\\s*:`).test(line)) return false; // ajv entry
  if (/\{\s*type:/.test(line)) return false;                                    // local schema
  return true;
}

/**
 * `timeCostDays` needs a path-aware test, and this is the clearest reason a
 * key-level gate is harder than it looks.
 *
 * Every one of those sixteen leaves is ALSO a `TimeCostAction` union member,
 * so the bare name appears all over the codebase as an action id -
 * `if (actionId === 'recharge')` in buildings/garage.ts is a comparison
 * against a string, not a read of `economy().timeCostDays.recharge`. A
 * name-based test therefore sees all eleven unread entries as "read" and the
 * allowlist entries as stale. The only two real reads are
 * `timeCostOf('recharge')` and `economy().timeCostDays.recharge`, so those are
 * the only two forms accepted.
 */
function isTimeCostRead(leaf: string): boolean {
  return (
    new RegExp(`timeCostOf\\(\\s*['"\`]${escape(leaf)}['"\`]\\s*\\)`).test(SOURCE_TEXT) ||
    new RegExp(`\\btimeCostDays\\s*\\.\\s*${escape(leaf)}\\b`).test(SOURCE_TEXT)
  );
}

/**
 * Reviewed allowlist, keyed by the JSON path within its file. Grouped by the
 * SHAPE of the reason, because the shape is what the next key will also have.
 */
const KNOWN_UNREAD: Readonly<Record<string, string>> = {
  // --- timeCostDays duplicating an authoritative service cost -------------
  // applyService advances by `service.days`; these are numerically identical,
  // so reading them too would advance the clock twice for one action.
  'timeCostDays.recharge': 'duplicates services.batteryRecharge.days (0); applyService already advances',
  'timeCostDays.bus': 'duplicates services.busToAdjacentCity.days (1); applyService already advances',
  'timeCostDays.cloneOrUpdate': 'duplicates services.clone.days (1); applyService already advances',
  'timeCostDays.healOnePoint': 'duplicates services.medicalPerPoint.days (7); applyService already advances',
  'timeCostDays.buyBodyArmor': 'duplicates services.bodyArmor.days (0); applyService already advances',

  // --- timeCostDays entries that are zero, so not reading is correct ------
  'timeCostDays.readRumor': '0 days, and the journal investigate actions genuinely cost no time',
  'timeCostDays.readRoadInfo': '0 days, same',
  'timeCostDays.readSchedule': '0 days, same',
  'timeCostDays.readJobList': '0 days, same',

  // --- superseded by a sibling key ----------------------------------------
  'radar.rangeMiles': "superseded by radar.visualRangeM (160m), which every radar, road-contact and AI-box read uses. A vestige of the source spec's imperial units.",

  // --- declared by the spec, not modelled by the sim ---------------------
  // Left in place because rulesets/ is the project's spec of record and
  // fidelity-notes.yaml is its provenance ledger: deleting a spec key because
  // the code has not caught up loses the record of what the design asks for.
  'casino.poker.allowAceLowStraight': "declared, not modelled: isStraight() hardcodes the ace-low wheel instead of reading this flag",
  'salvageCountsAsPayload': 'declared, not modelled: payloadSlotsUsed() has no salvage branch',
  'services.storeCar.paidOnRetrieval': 'a documentation field - the fee is read from retrieveCar.price, per the comments at sim/fleet.ts:38 and sim/services.ts:231',
  'latePayDecayPerDay': 'declared, not modelled: no late-pay decay is applied to courier pay',
  '_reconstruction.collisionArmorLossSpeedMph':
    'an exact DUPLICATE of driving.collision.armorLossSpeedMph, which is 25 in both files and is the copy applyCollision() actually reads (sim/driving.ts). Two owners for one rule: tuning the driving.json value leaves this one stale and nothing would notice, because nothing reads it. Remove this one rather than wire it.',
  'weapons.damageSkillDivisor': 'declared, not modelled: weapon damage does not scale by marksmanship',
  'driver.bodyArmorRepairable': 'declared, not modelled: the garage repairs body armour unconditionally',
  'salvageSkillGainWeights': 'declared, not modelled: searchWreck grants no skill gain',
  'prestigeGates': 'declared, not modelled: addPrestige/losePrestige apply no gate',
  'archetypes.buildCost': 'declared on arena archetypes, not modelled: no per-archetype build cost is charged',
  'salvage.burnedYieldsNothing': 'declared, not modelled: see app.ts:5998, which notes the rule is honoured by the wreck path rather than by this flag',
  'salvage.ammoTransfersIfWeaponMatches': 'declared, not modelled: wreck ammo transfer ignores the flag',
  'acceptanceCostDays': 'declared, not modelled: accepting courier work charges no acceptance days',
  'rumorsPerLocationPerDay': 'declared, not modelled: rumor draws are not rate-limited per location per day',

  // --- read by a TEST, as an invariant cross-check, and by nothing else ---
  // The game derives the amateur-night roster from `events[].opponentCount`;
  // no production path reads houseVehicle.totalCount. It exists so
  // tests/unit/arena.test.ts:61 can assert
  // `opponentCount + 1 === totalCount`, which is the "five opponents plus the
  // player's own loaner is six cars off this one row" invariant from the
  // ruleset's own _note. A test-only consumer is still a real consumer.
  'houseVehicle.totalCount': 'read only by tests/unit/arena.test.ts as an invariant cross-check against events[].opponentCount; no production path reads it',

  // --- keyed TABLES: read by a variable subscript, not by name ------------
  // A name-based scan cannot see these, because the key is a data value rather
  // than a property the code spells. They are listed as whole subtrees.
  // --- weapons.json fields on ONE weapon each, read by nothing ------------
  // Each of these is present on exactly one of the twelve weapons and has an
  // optional field in sim/types.ts plus an ajv entry, so both shape layers
  // name it. No code path reads any of the three.
  'weapons.penetrationBonus': 'declared on one weapon (id index 4, PROJECTILE) and read by nothing; sim/types.ts has it as an optional field and data/schema.ts validates it',
  'weapons.ammoIncluded': 'declared on one weapon (id index 11) and read by nothing; only sim/economy.ts:307 mentions it, in a comment',
  'weapons.oneShot': 'declared on one weapon (id index 11) and read by nothing; only sim/economy.ts:307 mentions it, in a comment',

  'championships.firstDay.*': "a map read as championships.firstDay[cityId] (sim/championship.ts:27). Only 9 of the 16 cities carry an entry, and championship.ts handles the undefined case explicitly.",
  'suspension.handlingClass.*': 'a map read as suspension.handlingClass[body.class] (sim/driving.ts:378 and sim/construct.ts:239), keyed by BodyClass',
};

interface KeyPath {
  readonly file: string;
  readonly path: string;
  readonly leaf: string;
  readonly parent: string;
}

function leafKeyPaths(): KeyPath[] {
  const out: KeyPath[] = [];
  // Metadata is decided by VALUE, not by name. `_note` and `_cityCountNote` are
  // strings of prose, while `_reconstruction` is an OBJECT of live gameplay
  // numbers (saleValueConditionFloor, repairCostFactor, cargoFullIntegrity,
  // latePayDecayPerDay, collisionArmorLossSpeedMph). Skipping every
  // `_`-prefixed key hid five real keys and made their allowlist entries look
  // stale; naming `_note` exactly would have hidden `_cityCountNote`.
  const isMeta = (key: string, child: unknown): boolean =>
    key.startsWith('$') || (key.startsWith('_') && typeof child === 'string');
  const walk = (value: unknown, prefix: string[], file: string): void => {
    if (Array.isArray(value)) {
      // An array of OBJECTS contributes its elements' keys, unioned across
      // every element: skills.json's `skills` entries do not all carry the
      // same fields, so element 0 alone would miss what elements 1..n declare.
      const objectElements = value.filter(
        (e): e is Record<string, unknown> => e !== null && typeof e === 'object' && !Array.isArray(e),
      );
      if (objectElements.length > 0) {
        const seen = new Set<string>();
        for (const element of objectElements) {
          for (const [key, child] of Object.entries(element)) {
            if (isMeta(key, child) || seen.has(key)) continue;
            seen.add(key);
            walk(child, [...prefix, key], file);
          }
        }
        return;
      }
      // An array of PRIMITIVES is itself the value. Recording nothing here
      // silently dropped every one of them: `_reconstruction.prestigeGates`
      // and `_reconstruction.mechanic.salvageSkillGainWeights` are number
      // arrays, and both were invisible to the walk even though both are
      // declared in sim/types.ts and validated in data/schema.ts.
      out.push({
        file,
        path: prefix.join('.'),
        leaf: prefix[prefix.length - 1]!,
        parent: prefix[prefix.length - 2] ?? '',
      });
      return;
    }
    if (value === null || typeof value !== 'object') {
      out.push({
        file,
        path: prefix.join('.'),
        leaf: prefix[prefix.length - 1]!,
        parent: prefix[prefix.length - 2] ?? '',
      });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (isMeta(key, child)) continue;
      walk(child, [...prefix, key], file);
    }
  };
  for (const dir of RULESET_DIRS) {
    for (const name of readdirSync(path.join(REPO, dir))) {
      if (!name.endsWith('.json')) continue;
      // strings.json is a FLAT map of dotted ids, read as string arguments to
      // t() and built by template for whole families (`` `facility.${kind}` ``),
      // so its keys do not fit the key-path model below. It is not covered by
      // this gate and that gap is recorded, not papered over.
      if (name === 'strings.json') continue;
      walk(JSON.parse(readFileSync(path.join(REPO, dir, name), 'utf8')), [], `${dir}/${name}`);
    }
  }
  return out;
}

const shortFile = (file: string): string =>
  file.split('/').slice(1).join('/').replace(/\.json$/, '');

describe('ruleset keys all have a reader or a documented reason they do not', () => {
  it('no undeclared unread key exists', () => {
    // KNOWN_UNREAD is keyed by the JSON path WITHIN its file, not by a file
    // prefix: the paths here (`radar.rangeMiles`, `timeCostDays.recharge`) are
    // unambiguous across the ruleset set, and keying by prefix meant a lookup
    // for file "timeCostDays" could never match file "classic/economy", so all
    // 24 entries reported stale and every dead key reported unreported at once.
    const known = new Map<string, string>();
    for (const [keyPath] of Object.entries(KNOWN_UNREAD)) known.set(keyPath, keyPath);

    const unreported: string[] = [];
    const stale: string[] = [];
    const matched = new Set<string>();

    for (const key of leafKeyPaths()) {
      // The `mentioned` pre-filter is what keeps this under the test timeout.
      // Without it every key walked all 20k lines, and a scan that times out
      // proves nothing. `mentioned` is a necessary condition for a read, so
      // short-circuiting on its negation cannot change the verdict - it only
      // skips the expensive classification for keys that are absent anyway.
      const lines = LINE_INDEX.get(key.leaf);
      const read =
        key.parent === 'timeCostDays'
          ? isTimeCostRead(key.leaf)
          : lines !== undefined && lines.some((l) => isReadLine(l.text, key.leaf));
      if (read) continue;
      // An entry may end in `.*` to cover a whole keyed table, e.g.
      // `championships.firstDay.*` for a map read as `firstDay[cityId]`.
      const hit = [...known.keys()].find((a) =>
        a.endsWith('.*') ? key.path.startsWith(a.slice(0, -1)) : key.path === a || key.path.endsWith(`.${a}`),
      );
      if (hit === undefined) unreported.push(`${shortFile(key.file)}#${key.path}`);
      else matched.add(hit);
    }

    // An allowlist entry that now HAS a reader is stale: either the wiring
    // landed and the entry should go, or the reader is incidental and the
    // entry is masking it. Both need a look, so both fail here.
    for (const keyPath of known.keys()) {
      if (!matched.has(keyPath)) stale.push(keyPath);
    }

    expect(
      { unreported, stale },
      'Add a reader, or list the key in KNOWN_UNREAD with the reason it has none. ' +
        'An unread ruleset key is invisible: ajv validates it, tsc types it, and ' +
        'nothing consumes it. Note that WIRING a timeCostDays entry is not ' +
        'automatically the fix - applyService already advances the clock by ' +
        'service.days, so reading both charges the day twice.',
    ).toEqual({ unreported: [], stale: [] });
  });

  it('the scan really reached the ruleset and can tell read from unread', () => {
    // A scan that finds nothing is a scan that is not working. This asserts
    // the walk produced a plausible number of paths, that the read detector
    // sees a key it must see, and that it does NOT see one it must not.
    const keys = leafKeyPaths();
    expect(keys.length).toBeGreaterThan(300);
    expect(LINE_INDEX.get('visualRangeM')?.some((l) => isReadLine(l.text, 'visualRangeM'))).toBe(true);
    expect(LINE_INDEX.get('damageSkillDivisor')?.some((l) => isReadLine(l.text, 'damageSkillDivisor')) ?? false).toBe(false);
    // `timeCostDays` leaves are also `TimeCostAction` union members, so only
    // the two real read forms count.
    expect(isTimeCostRead('repairCar')).toBe(true);
    expect(isTimeCostRead('recharge')).toBe(false);
  });
});
