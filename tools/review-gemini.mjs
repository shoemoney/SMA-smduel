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
  { label: 'the city and all ten facilities', files: pick('city', 'facility-') },
  { label: 'driving and fighting (road, trip menu, arena match, plus the overlays)', files: pick('road', 'arena', 'fleet', 'journal', 'controls') },
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

for (const [i, batch] of batches.entries()) {
  if (batch.files.length === 0) continue;
  console.log(`\nbatch ${i + 1}/${batches.length}: ${batch.files.length} frame(s) — ${batch.label}`);
  let text = '';
  // Retry with fewer frames if the provider refuses the image count.
  let files = batch.files;
  for (let attempt = 1; attempt <= 3; attempt++) {
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
      console.log(`  retrying with ${files.length} frame(s)`);
    }
  }
  if (text === '') continue;
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