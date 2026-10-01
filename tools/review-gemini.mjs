#!/usr/bin/env node
/**
 * Advisory review of the e2e capture, from the newest Gemini OpenRouter has.
 *
 * ## The model question, answered by measurement
 *
 * The task asks for "Gemini 4.0". `GET /api/v1/models` returns **no `gemini-4`
 * of any kind**, so this cannot be served as asked and the substitute is named
 * out loud rather than made silently. `--model` defaults to `google/gemini-3.8-flash`
 * (the newest numbered Gemini, and the model the 150-round log already used, so
 * the request shape is known-good) and accepts an override; `--pro` runs
 * `~google/gemini-pro-latest` instead. Both opinions are collected per round,
 * because a single vision model's recurring false findings are this repo's most
 * documented failure mode.
 *
 * ## Why the prompt argues with the model
 *
 * The 150-round log records eighty-odd iterations of a vision model reporting
 * three present elements as "missing" — the radar, the constructor schematic,
 * the city wall — dozens of times each, every one of them present at full
 * resolution. Widening the capture from 900px to 1280px reduced the class and
 * did not remove it. So the prompt states the failure mode, asks for a claim per
 * finding, and requires "nothing to report" as a valid answer. A review that must
 * produce findings manufactures them.
 *
 * ## Why batches
 *
 * The 26 frames at 2560x1600 are ~89MB base64, which no single request will take.
 * They are sent in themed batches, each with the same contract, and the answers
 * are concatenated. The reviewer therefore sees every screen, just not all at
 * once — and the batch boundaries are printed, so a reader can tell which answer
 * covers which screens.
 *
 * usage:
 *   node tools/review-gemini.mjs --shots .shots/e2e-r1
 *   node tools/review-gemini.mjs --shots .shots/e2e-r1 --model google/gemini-3.8-flash --tag r1
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const REVIEW_DIMENSIONS = [
  'gameplay — is the loop legible and does it read as vehicular combat?',
  'user experience — can a new player tell what to do, and does anything fight them?',
  'graphics — art, layout, contrast, and whether this looks like a finished product',
  'performance — anything visually expensive, noisy, or slow-reading',
  'THE BIG ONE: does this look like the 1986 game Autoduel reimagined in a modern manner — modern UI, modern inputs and buttons?',
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`review-gemini: --${name} needs a value`);
  return v;
}

const KEY = (() => {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.trim();
  return readFileSync(resolve(homedir(), '.config/openrouter/key'), 'utf8').trim();
})();

const MODEL = arg('model', process.argv.includes('--pro') ? '~google/gemini-pro-latest' : 'google/gemini-3.8-flash');
const SHOTS = arg('shots', '.shots/e2e-r1');
const TAG = arg('tag', 'r1');
const OUT_DIR = '.opencode/reviews';

function promptFor(batchLabel) {
  return `You are a senior game director reviewing **OpenDuel**, a browser vehicular-combat RPG: a modern reimagining of Autoduel (1985). These frames are a full playthrough — title, driver creation, the constructor, the city, every facility, the road, and a real arena match.

${batchLabel ? `This batch covers: ${batchLabel}\n` : ''}
## Review these dimensions

${REVIEW_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join('\n')}

## What has already been checked, so you do not repeat it

These were real defects, found and FIXED. Do not report them again:
- a boot tribute card on black, white type with every bold word yellow
- an ignition switch whose key turns and a car starts before the driver is built
- every input rebuilt as one shared, icon-led, themed control
- the constructor split into Identity / Powertrain / Armour / Weapons / Build, with a chevron rotated per armour facing
- a message panel that used to cover the pause hint

## How to report — this matters more than it looks

- **"No findings" is a correct and welcome answer.** Do not invent work. A review that must produce findings will produce findings, and they will be wrong.
- **One claim per finding**, and state WHERE it is (which frame, which part of the screen).
- **Separate what you SAW from what you INFER.** If you are reading intent rather than reading pixels, say so.
- **Before reporting an element as missing, blank, or broken, look again at full resolution.** This game's HUD is small, dense, and deliberately understated. Over eighty prior review rounds, three present elements — the radar, the constructor's vehicle schematic, and the city wall — were each reported "missing" dozens of times while being plainly visible. A dim element is not an absent one.
- Prefer findings you can point at. "The pause key is hidden" is worth reporting; "the vibe could be more retro" is not.

## Output format

FINDINGS: <number>
Then, for each:
### <n>. <one-line title>
- **Where:** <frame and screen region>
- **What I see:** <the observation>
- **Why it matters:** <the consequence for a player>
- **Suggested fix:** <what you would change>

If there is nothing worth changing, output exactly:
FINDINGS: 0
NOTHING_TO_REPORT: <one line saying what you checked and found sound>`;
}

/** Sends one batch. Returns the assistant text. */
async function send(label, files) {
  const parts = [{ type: 'text', text: promptFor(label) }];
  for (const f of files) {
    // `files` holds basenames from readdir, so the directory has to be put back
    // on — the first version passed the bare name to readFileSync and every batch
    // failed with ENOENT.
    const full = resolve(SHOTS, f);
    const b64 = readFileSync(full).toString('base64');
    parts.push({ type: 'text', text: `Frame: ${f}` });
    parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://shoemoney.ai',
      'X-Title': 'openduel-gemini-review',
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: parts }], max_tokens: 16000 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`review-gemini: ${res.status} ${res.statusText}\n${body.slice(0, 700)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

const all = (await readdir(SHOTS)).filter((f) => f.endsWith('.png')).sort();
if (all.length === 0) throw new Error(`review-gemini: no PNGs in ${SHOTS}`);

// Batches, grouped so each request is themed and small enough to be accepted.
const pick = (...needles) => all.filter((f) => needles.some((n) => f.includes(n)));
const batches = [
  { label: 'the opening and the build (title, driver creation, ignition crank, constructor)', files: pick('boot-tribute', 'title', 'driver-', 'ignition', 'constructor-') },
  { label: 'the city and the first five facilities', files: pick('city', 'facility-garage', 'facility-weaponshop', 'facility-arena', 'facility-salvage', 'facility-bar') },
  { label: 'the remaining five facilities', files: pick('facility-medical', 'facility-assembly', 'facility-courierguild', 'facility-truckstop', 'facility-federal') },
  { label: 'driving (road, the trip menu, and the overlays)', files: pick('road', 'fleet', 'journal', 'controls') },
  { label: 'fighting (an arena match, entry and combat)', files: pick('arena-') },
];
const covered = new Set(batches.flatMap((b) => b.files));
const missed = all.filter((f) => !covered.has(f));
if (missed.length > 0) console.log(`note: ${missed.length} frame(s) not matched by any batch: ${missed.join(', ')}`);

mkdirSync(OUT_DIR, { recursive: true });
const outFile = resolve(OUT_DIR, `gemini-${TAG}-${MODEL.replace(/[^a-z0-9]+/gi, '-')}.md`);

const sections = [`# OpenDuel advisory review — ${MODEL}`, '', `- Frames: ${SHOTS} (${all.length} PNGs, 2560x1600)`, `- Model: \`${MODEL}\``, `- Date: ${new Date().toISOString()}`, ''];

let totalFindings = 0;
let anyNothingToReport = false;
let failedBatches = 0;
let silentBatches = 0;

for (const [i, batch] of batches.entries()) {
  if (batch.files.length === 0) continue;
  console.log(`\nbatch ${i + 1}/${batches.length}: ${batch.files.length} frame(s) — ${batch.label}`);
  let text = '';
  // Retry with fewer frames if the provider refuses the image count — and SAY SO,
  // loudly, because round 1 lost half the review to a silent truncation: batches
  // came back reporting 6 of 11 and 5 of 9 frames and the run still printed a
  // confident "total FINDINGS: 5". A review that saw half the game is not a
  // review, and the output has to be unable to pretend otherwise.
  let files = batch.files;
  let truncated = false;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      text = await send(batch.label, files);
      break;
    } catch (err) {
      const msg = String(err);
      if (attempt === 3 || !/image|too large|413|400/.test(msg)) {
        sections.push(`## Batch ${i + 1} — ${batch.label}`, '', '```', `REVIEW FAILED: ${msg.slice(0, 400)}`, '```', '');
        console.error(`  batch ${i + 1} failed: ${msg.slice(0, 160)}`);
        failedBatches += 1;
        break;
      }
      files = files.slice(0, Math.max(1, Math.floor(files.length * 0.6)));
      truncated = true;
      console.log(`  PROVIDER REFUSED ${batch.files.length} frames; retrying with ${files.length}`);
    }
  }
  if (text === '') {
    // An EMPTY answer is not a zero-finding answer. Skipping it silently is how
    // this script reported "total FINDINGS: 0" while TWO of its five batches had
    // produced no output at all — the same "a green number standing in for work
    // that never happened" failure this whole round has been about, committed by
    // the very tool meant to detect it. A round that did not answer every batch
    // is not a clean round.
    silentBatches += 1;
    sections.push(`## Batch ${i + 1} — ${batch.label}`, '', '```', 'NO ANSWER: the provider returned an empty body for this batch.', '```', '');
    console.log(`  batch ${i + 1} produced NO ANSWER`);
    continue;
  }
  if (truncated) {
    const dropped = batch.files.length - files.length;
    sections.push(`> **COVERAGE GAP: this batch shows ${files.length} of ${batch.files.length} frames; ${dropped} were not reviewed.**`, '');
    console.log(`  COVERAGE GAP: only ${files.length} of ${batch.files.length} frames reached the reviewer`);
  }
  const m = text.match(/FINDINGS:\s*(\d+)/);
  const n = m === null ? 0 : Number(m[1]);
  totalFindings += Number.isFinite(n) ? n : 0;
  if (/NOTHING_TO_REPORT/.test(text)) anyNothingToReport = true;
  sections.push(`## Batch ${i + 1} — ${batch.label}`, '', '```', text.trim(), '```', '');
  console.log(`  FINDINGS: ${n}`);
}

sections.push('---', '', `**Total FINDINGS across batches: ${totalFindings}**`, anyNothingToReport ? '**At least one batch reported nothing to report.**' : '');
writeFileSync(outFile, sections.join('\n'));
console.log(`\nreview written to ${outFile}`);
console.log(`total FINDINGS: ${totalFindings}`);
// --- Completeness gate -------------------------------------------------------
//
// The completion condition for this whole loop is "a final round returns no
// actionable input", and a round where a batch never answered has not earned
// that. This script previously incremented `failedBatches` and never checked it,
// and skipped an empty answer with a bare `continue` — which is how it reported
// a confident "total FINDINGS: 0" while two of its five batches had produced no
// output at all. The same failure this round spent twelve iterations documenting,
// committed by the tool meant to detect it.
{
  const withFrames = batches.filter((b) => b.files.length > 0).length;
  const answered = withFrames - failedBatches - silentBatches;
  console.log(`batches answered: ${answered}/${withFrames}`);
  if (failedBatches > 0 || silentBatches > 0 || answered !== withFrames) {
    console.error(
      `\nINCOMPLETE REVIEW: ${failedBatches} batch(es) failed, ${silentBatches} produced no answer ` +
        `(${answered}/${withFrames} answered). This is NOT a clean round.`,
    );
    process.exitCode = 1;
  } else if (totalFindings === 0) {
    console.log('CLEAN ROUND: every batch answered, no actionable input.');
  }
}
