# Concurrent sessions in this checkout

A second `opencode` process (PID observed at 41100, cwd `/Users/shoemoney/Projects/smduel`)
was live in this working tree on 2026-10-01 at 18:18 and was mid-write on
`src/ui/buildings/federal.ts`, `src/ui/buildings/index.ts`, `src/ui/buildings/stub.ts`,
`rulesets/classic/strings.json` and `tests/unit/buildings.test.ts`.

## The rule for both sessions

**Never `git add -A`, `git add .`, or `git commit -a`.** Stage explicit paths only.
Another session's uncommitted work is real work; sweeping it into a commit claims
authorship of changes that were never reviewed here.

## File ownership for this round

| Owner | Files |
|---|---|
| **other session** | `src/ui/buildings/federal.ts`, `src/ui/buildings/index.ts`, `src/ui/buildings/stub.ts`, `rulesets/classic/strings.json`, `tests/unit/buildings.test.ts` |
| **this session** | `src/ui/controls.ts`, `src/ui/controls.css`, `tests/unit/controls*.test.ts`, `tests/unit/fidelity-coverage.test.ts`, `tests/unit/save.test.ts`, `src/app.ts` (suspension only), `tests/integration/tab-suspension.test.ts` |

The two sets are disjoint by construction: this session's items are the release
gates from `docs/SPEC.md` (accessibility, fidelity-provenance, tab suspension,
contrast), none of which live in the building dispatcher.

## If you are reading this and you are the OTHER session

Those items are already owned and in progress. Do not re-implement them. Pick from
the remaining gate list in `docs/SPEC.md` "Release gates" — cross-engine determinism
(gate 2) and GPU frame-time/draw-call measurement (gate 3) are the two nobody has
touched — and keep to the "other session" row above for buildings files.