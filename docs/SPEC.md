# smduel — mechanics specification

A browser recreation of a 1985 top-down vehicular-combat action-RPG, built clean-room:
original numbers where the source manual documents them, original naming and fiction
throughout. **No protected marks, characters, maps, art, or text.**

All *numbers* live in `rulesets/classic/*.json` and are the single source of truth.
This document holds the *rules* the tables cannot express.

## Confidence labels

Every constant carries a status in `rulesets/classic/fidelity-notes.yaml`:

| Status | Meaning |
|---|---|
| **Exact** | Stated by the original manual's tables. Construction costs, weights, spaces, DP, capacities, service prices. |
| **Observed** | Documented repeatedly through play but never published as a formula. Division rewards, prestige gates, championship dates. |
| **Reconstruction** | Our tunable implementation, chosen to reproduce documented behavior. Every weapon range/cooldown/accuracy/damage, all driving coefficients, all economy decay curves. |

The original source code is not public, so no claim of cycle-exact fidelity is made or
permitted in user-facing copy. This is *a mechanically faithful recreation using
documented rules*.

## Simulation authority

The CPU owns all canonical state. WebGPU renders read-only snapshots and may run cosmetic
particles only. Authoritative movement, collision, hit resolution, damage, economy, RNG,
and saves never touch the GPU — this keeps outcomes identical across drivers and makes
replay-based regression testing possible.

Fixed timestep, 60 Hz, independent of display refresh:

    accumulator += min(frameDelta, 250ms)
    while (accumulator >= 1/60s) { sampleBufferedInput(); step(); accumulator -= 1/60s }
    render(interpolate(prev, cur, accumulator / dt))

`step()` never reads a wall clock. Determinism gate: same seed + same input stream must
produce identical state hashes every 60 ticks, across Chromium, Firefox, and WebKit.

## Game states

| State | Control | Time | Exits |
|---|---|---|---|
| Title | menu | frozen | continue, load driver, create driver |
| Driver creation | form | frozen | valid name + exactly 50 points allocated |
| City | 8-way walk, or drive the parked car at `driving.city.vehicleSpeedMps` | **no time passes** | building, gate, vehicle, status |
| Building | numbered menu | per transaction | city, or overnight |
| Constructor | row nav | 1 day on purchase | cancel, or confirm a legal build |
| Highway | real-time | advances per road interval | gate, death, abandonment |
| Arena | real-time | 1 day | victory exit, retreat, death, forfeit |
| Overnight | modal | +1 day | new day in city |
| Clone recovery | modal | loads stored skills | resume in clone's city |

## Controls

The original maps a single stick to *direction and throttle together*: direction of push
is desired travel direction, distance from center is requested speed, centering coasts,
and pulling opposite brakes then reverses (capped 20 mph).

**Classic Input** preset preserves exactly that, plus active-weapon cycling.
**Modern Input** may split steer and throttle but must NOT introduce free aim — weapon
facings are fixed at construction and are load-bearing for combat balance.

Defaults: WASD/arrows or left stick to drive · J/LMB or right trigger to fire · Q/E or
bumpers to cycle weapons · 1-0 direct select · G enter/exit car · Enter confirm · Esc
cancel/pause · F3 car, F4 fleet, F5 tasks, F8 driver, L location · F6 save & quit.

## Driver

Created with a 1-16 char name and **exactly 50 points** split across driving,
marksmanship, mechanic (each 0-99). Starts: $2,000, 3 natural health DP, no body armor,
0 prestige, in the starting city on day 0 (2030-01-01).

- **Driving** improves handling and reduces loss-of-control. Rises from road miles and arena wins.
- **Marksmanship** raises hit chance and damage. Rises from successful combat.
- **Mechanic** governs salvage yield. Rises from successful salvage and $500 lessons
  (5 days each, progressively less likely to help a higher skill).

Body armor adds 3 expendable DP, is never repaired, and a new suit replaces the old.
Damage consumes body armor before natural health. Natural health 0 = death.
A clone ($5,000) stores one skill snapshot; an update ($3,000) replaces it. Reviving
keeps current cash and prestige and every car **except the one destroyed**.
No clone = the driver is permanently dead.

Prestige rises from arena wins, delivered cargo, and vigilantism; falls from late or
failed deliveries, fleeing events, and selling cargo dishonestly. **Floor is 0.**

## Calendar

Integer `dayIndex` + `DAY|NIGHT` phase. Deadlines compare `dayIndex` only.

Free: walking, rumors, road reports, schedules, job listings, recharging, buying armor.
One day: bus, building a car, weapon transactions, repairs, accepting work, an arena
event, cloning. Five days: a mechanic lesson. Seven days: one point of healing.

Bar, truck stops, medical, and the federal building never close. Everything else is
daytime-only, and **any transaction costing a day closes the daytime businesses** until
the next day starts.

## Construction

    modifiedMaxLoad = floor(body.baseMaxLoad * chassis.loadMultiplier)
    weight = body + plant + 4*tire + weapons + ammo + armorPoints*body.armorWeightPerPoint + cargo
    spaces = plant + weapons + cargo
    cost   = body + body*chassis.priceMod + body*suspension.priceMod
           + plant + 4*tire + weapons + ammo + armorPoints*body.armorCostPerPoint

Chassis and suspension add **cost only** — never weight, never spaces.
Handling class 0-3 from suspension, keyed by body class.

    power >= weight     -> 15 mph/s
    power >= weight/2   -> 10 mph/s
    power >= weight/3   ->  5 mph/s
    otherwise           -> ILLEGAL

Armor is assigned per facing (front/rear/left/right/underbody); one point absorbs one
damage point. Cost and weight per point depend only on body, not facing.
Four identical tires are mandatory and the type is immutable after purchase. Tires are
replaced, never repaired. Solid tires are immune to spikes.

Intermediate illegal designs are allowed during editing and must show `?????` for derived
values rather than a wrong number. Finalization is blocked on any violation.

## Combat

Real-time, top-down, only the active weapon fires, weapons bear on fixed cardinal facings.

Fire pipeline: validate (exists, has DP, off cooldown, bears, has ammo/battery) ->
**consume ammo at trigger time, so a miss still costs the round** -> spawn projectile /
hitscan / cone / deployable -> resolve accuracy -> roll damage on the seeded RNG ->
apply armor and penetration -> update HUD and skill progress.

Impact facing, in target-local space:

    abs(local.x) > abs(local.y) ? (local.x > 0 ? RIGHT : LEFT)
                                : (local.y > 0 ? FRONT : REAR)

Penetration order: armor on the struck facing -> weapons mounted on that facing -> then
FRONT reaches the plant before the driver; SIDE may reach driver, plant, or cargo; REAR
uses a **data-driven weighted table** because the manual never published a sequence.
Driver damage eats body armor first. Cargo at 0 integrity is lost and its job fails.

Mines strike UNDERBODY and may splash tires. Spikes hit tires only and do **zero** to
solid tires. A full battery is 99 and a laser costs exactly 1 per shot — so a stationary
car with a full battery fires exactly 99 shots.

A destroyed power plant disables acceleration and the laser but **does not kill the
driver**; the car still steers and coasts, and the driver may get out and walk.

## Arena

Enter through the gate, defeat every opponent, then **drive out under the car's own
power** — that last clause is the win condition, not the last kill. Escaping early costs
prestige; escaping on foot forfeits the vehicle entirely.

Events: practice ($20, no reward) · amateur night (entered on foot, house-supplied kart,
for drivers under the cash or prestige bar) · divisions capped by car value · unlimited ·
city championship every 84 days. AI obeys identical rules to the player — same ammo,
armor, tires, control loss. Opponent threat-weighting toward the player is a calibration
knob, never a hidden constant.

## Road

A fixed graph of walled cities. Each route carries a length, a danger rating, and an
encounter table. **Not all traffic is hostile** — lawful drivers pass peacefully if left
alone and retaliate if attacked. Outlaws may run in packs; clustered radar contacts are
the warning. Well-travelled roads are safer.

Wrecks persist for same-day return and are stripped overnight, as are mines and spikes.
Smoke dissipates in seconds, oil in hours.

Salvage: stop, get out, search the wreck. One roll per wreck against Mechanic — a
**searched flag prevents save-scumming a reroll**. Burning wrecks yield nothing. Matching
ammo transfers up to magazine capacity; everything else becomes abstract cargo that
occupies weight and space and cannot be installed.

## Courier

Three jobs offered per visit. Acceptance costs a day; multiple jobs taken in one
transaction share that day. A vehicle carries at most **three payloads**, and accumulated
salvage counts as one more cargo category against that limit. Jobs are refused for
insufficient prestige, survivability, space, or load.

Delivery means entering the exact destination building with intact cargo. Late delivery
pays less and costs reputation. Selling a payload dishonestly pays a fraction and costs
prestige.

## Campaign

Prestige-gated rumor chains at 20/40/60/80/95 (Observed, unverified) lead to a final
delivery. Taking the last job removes the player's clone, marks them, and creates
sustained pursuit including attacks while resting. Completing it is the win state, and
the sandbox remains playable afterward.

## Saves

IndexedDB only — never localStorage. Two-phase commit: write a checksummed generation,
verify by reading back, **then** advance the active pointer. Three rolling generations.
A torn write must never cost a driver.

**Classic Save** restores a road or arena save to the last city snapshot, matching the
original's semantics. **Safe Save** (default) autosaves on city entry and after every
completed transaction. Browser or tab failure must never kill a driver.

## Release gates

1. Every table row asserted by a test; golden fixtures match documented arithmetic.
2. Determinism holds across three browser engines over 10,000 ticks.
3. Budgets met: sim <=4ms/tick, render prep <=3ms/frame, GPU <=10ms @1080p, <=150 draw
   calls typical, <=25 MB initial download.
4. Device loss, resize, and tab suspension all recover without corruption.
5. No information conveyed by color alone; full keyboard operation.
6. Every Reconstruction constant has a provenance entry **and** a test.

## Open fidelity questions

Unresolved until black-box measurement against a legitimately obtained reference build.
Until then these stay explicitly labelled Reconstruction:

world scale and car dimensions · the acceleration tier's time unit · braking and coast
drag · the maneuver-stress and control-loss formula · battery drain from driving and the
radar-failure threshold · every weapon's range, cooldown, projectile speed, hit chance,
and damage distribution · cloud sizes and lifetimes · AI perception, target selection,
player bias, and spawn budgets · repair, resale, and salvage-offer equations · skill-gain
increments · prestige deltas per event · courier generation and pay formulas · route
mileages and the distance-to-calendar conversion · rear and side interior damage weights ·
fire/ignition probability · the house kart's exact build · platform differences.
