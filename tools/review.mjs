#!/usr/bin/env node
/**
 * Sends real screenshots of the real game to a vision model on OpenRouter and
 * prints back exactly five concrete improvements.
 *
 * ## Why this is a tool and not just a prompt
 *
 * A vision review is only worth anything if the model is looking at the actual
 * rendered frames rather than a description of them. The screenshots come from
 * `tools/shoot.mjs`, which drives the real game in real Chrome with a real
 * WebGPU adapter, so every claim a reviewer makes is about a frame that really
 * rendered. The reviewer's own numbers (it cannot measure ours) are recorded
 * separately from the harness's measured numbers, because they are different
 * kinds of evidence and conflating them is how a plausible-sounding opinion
 * becomes a "verified" claim.
 *
 * ## Why images are downscaled first
 *
 * Screenshots are captured at 1440x900. A 1440-wide frame is several thousand
 * vision tokens per image, and sending eight of those is both slow and, past a
 * point, counterproductive: a reviewer given a huge image and a short question
 * answers the question. The frames are resized to a sane review size with
 * `sips` before upload so the model is looking at the COMPOSITION, which is what
 * it is being asked about.
 *
 * usage:
 *   node tools/review.mjs --model google/gemini-3.8-flash
 *   node tools/review.mjs --model z-ai/glm-5.3-flash --screens arena,city
 *   node tools/review.mjs --list          # show the pool, marking what is asked
 *   node tools/review.mjs --pick          # a random eligible model not yet asked
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const KEY = (await readFile(`${process.env.HOME}/.config/openrouter/key`, 'utf8')).trim();
const OUT_DIR = resolve('.opencode/reviews');

/** Screens worth a design review: the three rendered worlds plus the two frames a player meets first. */
const DEFAULT_SCREENS = ['title', 'city', 'arena', 'road', 'constructor'];
/**
 * Width the captures are downscaled to before upload.
 *
 * 900px was too small, and not merely a token saving: SEVERAL reviews have now
 * reported things that are simply not in the frame. One described the city's
 * perimeter wall as a "giant dashed debug circle" — at 1440px it is a solid
 * segmented barrier, and the "dashes" are the segment gaps aliasing at small
 * size. Two described the radar's rings and sweep as absent, which required
 * checking a full-resolution crop to disprove. And one quoted a constructor
 * caption reading "6 mounted" on a frame whose caption reads "0 mounted".
 *
 * A reviewer looking at a smaller image than a player does is not a stricter
 * reviewer, it is a differently-informed one, and its false findings cost more
 * than its true ones are worth. 1280 keeps the frames near native while still
 * being a reasonable upload.
 */
const REVIEW_WIDTH = 1280;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const LOOP_LOG = new URL('../.opencode/ralph-loop.local.md', import.meta.url);

/**
 * The eligible-reviewer filter, in ONE place.
 *
 * Iteration 15 picked `google/gemini-3-pro-image-preview` — an image
 * GENERATION model, not a critic — because the exclusion pattern was `-image$`
 * and that id ends in `-preview`. It got fixed, but in an ad-hoc shell snippet
 * rather than here, so two copies of the filter existed and had already drifted.
 * There is now exactly one, and both `--list` and `--pick` call it.
 *
 * Excluded, with reasons:
 *  - not image-input          : cannot look at a screenshot at all
 *  - `:batch` / leading `~`   : aliases and pinned snapshots, not distinct models
 *  - image generation         : returns art, not an opinion
 *  - speech / audio           : not reviewers
 *  - safety / guard / censor  : these answer "is this safe", not "is this good"
 *                               (they answered a safety question when asked for a
 *                               design one, and it had to be thrown away)
 *  - `:free`                  : free tiers get silently re-pointed and throttle
 */
function isReviewerCandidate(m) {
  const id = m.id;
  if (m.architecture?.input_modalities?.includes('image') !== true) return false;
  if (id.includes(':batch') || id.startsWith('~')) return false;
  if (/image-gen|-image|image-|tts|whisper|stable-diffusion|flux|sd3|dall|ideogram|recraft|safety|guard|moderation|censor/i.test(id)) return false;
  if (id.endsWith(':free')) return false;
  return /flash|mini|lite|glm|gemini-3|qwen3|step|seed|mimo|nemotron|granite|ministral/.test(id);
}

async function fetchModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`review: OpenRouter /models returned ${res.status}`);
  return (await res.json()).data;
}

/** Model ids already asked, parsed from the loop log so the two cannot drift. */
function readReviewedIds() {
  // Deliberately NOT wrapped in a try/catch that returns []. That shape is how
  // this function shipped a ReferenceError for an unimported `readFileSync` and
  // reported "0 models asked so far" as if it were the truth — the picker would
  // then cheerfully re-ask models the loop had already used, forever, while
  // looking perfectly healthy. An unreadable log is a hard error here, because
  // the only safe response to "I don't know what has been asked" is to stop.
  const text = readFileSync(LOOP_LOG, 'utf8');
  const ids = text
    .split('\n')
    .filter((l) => /^\s*\d+\.\s/.test(l))
    .map((l) => /(\d+)\.\s+([\w./:-]+)/.exec(l)?.[2])
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error(`review: no reviewer ids parsed from ${LOOP_LOG.pathname} — refusing to pick`);
  }
  return ids;
}

if (arg('pick', false) !== false) {
  const reviewed = new Set(readReviewedIds());
  const eligible = (await fetchModels()).filter((m) => isReviewerCandidate(m) && !reviewed.has(m.id));
  if (eligible.length === 0) throw new Error('review: every eligible model has already been asked');
  console.log(eligible[Math.floor(Math.random() * eligible.length)].id);
  process.exit(0);
}

if (arg('list', false) !== false) {
  const reviewed = new Set(readReviewedIds());
  const eligible = (await fetchModels()).filter(isReviewerCandidate);
  const fresh = eligible.filter((m) => !reviewed.has(m.id));
  console.log(`${eligible.length} vision models in the pool (${fresh.length} not yet asked):`);
  for (const m of eligible) console.log(`  ${reviewed.has(m.id) ? '[x]' : '[ ]'} ${m.id}`);
  process.exit(0);
}

/** Resizes a capture to review size so the model reads composition, not pixels. */
async function reviewSized(src) {
  const out = resolve('.opencode/reviews', `_small_${basename(src)}`);
  await execFileAsync('sips', ['-Z', String(REVIEW_WIDTH), src, '--out', out]);
  return out;
}

const PROMPT = `You are a senior game-art director reviewing a browser game called "smduel" — a top-down vehicular combat RPG where you build a car, run courier work, survive a highway, and fight in arenas. It renders with WebGPU.

You are looking at REAL screenshots from the running game, captured in real Chrome with a real GPU. They are resized down; judge COMPOSITION, READABILITY and CRAFT, not pixel detail.

The screens are: a title screen, the open-world city, the arena, the road, and the vehicle constructor.

Review ALL of them together and identify exactly FIVE specific things to improve. For each:

- TITLE: a short, concrete name for the issue
- WHERE: which screen(s), and where on the screen
- PROBLEM: what is actually wrong or weak, in visual terms
- WHY: why it hurts the player — legibility, feel, hierarchy, atmosphere, readability at speed
- FIX: a specific, implementable suggestion (not "make it nicer")

Hard rules:
- Be specific and visual. "Improve the UI" is worthless. "The radar is a black disc with no visible sweep or contacts, so it reads as broken rather than as an instrument" is useful.
- Prioritise what a player would NOTICE first, and what makes the game look unfinished.
- Do not invent problems that are not visible in these frames. If something looks fine, do not list it.
- Prefer legibility, contrast, hierarchy, and feedback over decoration.

Return ONLY a JSON array of exactly 5 objects with keys: title, where, problem, why, fix. No prose, no markdown fence, no preamble, no explanation before or after the array. Start your reply with the character [.`;

const model = String(arg('model', ''));
if (model === '') throw new Error('review: --model is required (see --list, or use --pick)');
const screens = String(arg('screens', DEFAULT_SCREENS.join(',')))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const shotsDir = resolve(String(arg('shots', '.shots/final4')));

await mkdir(OUT_DIR, { recursive: true });

const frames = [];
for (const screen of screens) {
  const file = resolve(shotsDir, `${screen}.png`);
  try {
    const sized = await reviewSized(file);
    const b64 = await readFile(sized);
    frames.push({ screen, b64: b64.toString('base64') });
  } catch {
    console.error(`review: no capture for "${screen}" in ${shotsDir} — skipping`);
  }
}
if (frames.length === 0) throw new Error(`review: none of [${screens}] exist in ${shotsDir}`);

console.error(`review: asking ${model} about [${frames.map((f) => f.screen).join(', ')}]…`);

/**
 * Sends the request, halving the image count and retrying if the provider
 * rejects it for too many images.
 *
 * Not every provider accepts five images: `inclusionai/ling-3.0-flash-vl`
 * returned "Too many images in request: 5 > 4" and aborted the whole review.
 * Rather than hand-tuning a screen list per model — which would quietly give
 * some reviewers a different view of the game than others, and make the
 * reviews non-comparable — the harness retries with the most important screens
 * only, in a fixed priority order, and records how many it actually sent.
 *
 * The order is deliberate: the three rendered worlds first, then the two
 * menu screens, because a review that loses images should lose the least
 * informative ones.
 */
const SCREEN_PRIORITY = ['title', 'arena', 'road', 'city', 'constructor'];

async function send(frames) {
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          ...frames.flatMap((f) => [
            { type: 'text', text: `Screenshot: ${f.screen}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${f.b64}` } },
          ]),
        ],
      },
    ],
    // Temperature is left at the provider default. We want this model's actual
    // opinion, not a sampled one; and the JSON contract in the prompt is tight
    // enough that a low temperature buys nothing.
    // DeepSeek's iteration-4 reply was cut off mid-string at 4000 tokens, which
    // made the whole review unparseable. 5 detailed findings plus a preamble is
    // a lot of text; 9000 leaves room for a model that thinks out loud.
    max_tokens: 16000,
  };
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://shoemoney.ai',
      'X-Title': 'smduel-review-loop',
    },
    body: JSON.stringify(body),
  });
}

const ordered = frames.sort((a, b) => SCREEN_PRIORITY.indexOf(a.screen) - SCREEN_PRIORITY.indexOf(b.screen));
let sent = ordered;
let res = await send(sent);
let lastBody = '';
while (!res.ok && sent.length > 1) {
  lastBody = await res.text();
  if (!/too many images|maximum .* image|image limit/i.test(lastBody)) break;
  sent = sent.slice(0, Math.max(1, sent.length - 1));
  console.error(`review: provider rejected ${sent.length + 1} images, retrying with ${sent.length}`);
  res = await send(sent);
}
const screensSent = sent.map((f) => f.screen);

if (!res.ok) {
  const body = lastBody || (await res.text());
  throw new Error(`review: ${res.status} ${res.statusText}\n${body.slice(0, 800)}`);
}
const json = await res.json();
const raw = json.choices?.[0]?.message?.content ?? '';

/**
 * Repairs unescaped double quotes inside JSON string values.
 *
 * Models emit `"The active "New Driver" option ..."` — raw quotes nested in a
 * string value, which terminate it early and make the WHOLE review unparseable.
 * A real case: bytedance-seed/seed-2.0-lite returned five complete, well-formed
 * findings with `finishReason: "stop"` and a perfectly complete array, and lost
 * all of them to two quote characters. The harness losing a good reviewer to a
 * formatting slip is the same class of failure as the two earlier ones in this
 * file's history (an empty body recorded as if it were fact, and a picker that
 * reported "0 models asked" because its read had silently failed).
 *
 * The repair is deliberately narrow. A `"` is only rewritten when it is inside an
 * open string AND the next non-whitespace character cannot legally continue a
 * JSON string (one of `,` `}` `]` `:`). A closing quote is always followed by one
 * of those, so genuine string boundaries are never touched; a bare quote in the
 * middle of prose is followed by a letter and gets escaped. That is the only
 * transformation applied, and if the result still fails to parse the original
 * error is surfaced unchanged rather than a second, more confusing one.
 */
function escapeBareQuotesInStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }
      // Look ahead past whitespace: a real closing quote is followed by a
      // structural character, a bare one by prose.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      const next = text[j];
      if (next === ',' || next === '}' || next === ']' || next === ':') {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (ch === '\n') {
      // A literal newline inside a string is also invalid JSON; models do it
      // when a "quote" swallowed the rest of the value.
      out += inString ? '\\n' : ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Extracts the JSON array from a model reply that may or may not have fenced it. */
function parseFindings(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`no JSON array in reply:\n${text.slice(0, 500)}`);
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    const repaired = escapeBareQuotesInStrings(slice);
    if (repaired === slice) throw err;
    return JSON.parse(repaired);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = resolve(OUT_DIR, `${stamp}__${model.replace(/[/:]/g, '_')}.json`);

let findings = null;
let parseError = null;
try {
  findings = parseFindings(raw);
} catch (err) {
  parseError = String(err);
}

await writeFile(
  outFile,
  `${JSON.stringify(
    {
      model,
      modelLabel: json.model ?? model,
      screens: screensSent,
      at: new Date().toISOString(),
      usage: json.usage ?? null,
      // Recorded because a review can come back with an EMPTY body and no
      // error: `google/gemini-2.5-pro` returned nothing at all on the combat
      // screenshots, and without the finish reason that is indistinguishable
      // from a harness bug. It is `stop`/`length`/`content_filter`/etc.
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      findings,
      parseError,
      raw,
    },
    null,
    2,
  )}\n`,
);

if (parseError !== null) {
  console.error(`review: ${model} did not return parseable JSON -> ${outFile}`);
  console.error(raw.slice(0, 900));
  process.exit(1);
}

console.log(`\n=== ${json.model ?? model} ===`);
for (const [i, f] of findings.entries()) {
  console.log(`\n${i + 1}. ${f.title}`);
  console.log(`   where:  ${f.where}`);
  console.log(`   problem:${f.problem}`);
  console.log(`   why:    ${f.why}`);
  console.log(`   fix:    ${f.fix}`);
}
console.log(`\nsaved -> ${outFile}`);
