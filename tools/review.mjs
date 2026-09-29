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
 *   node tools/review.mjs --list          # show the model pool
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const KEY = (await readFile(`${process.env.HOME}/.config/openrouter/key`, 'utf8')).trim();
const OUT_DIR = resolve('.opencode/reviews');

/** Screens worth a design review: the three rendered worlds plus the two frames a player meets first. */
const DEFAULT_SCREENS = ['title', 'city', 'arena', 'road', 'constructor'];
const REVIEW_WIDTH = 900;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

if (arg('list', false) !== false) {
  const pool = await fetchPool();
  console.log(`${pool.length} vision models in the pool:`);
  for (const id of pool) console.log(`  ${id}`);
  process.exit(0);
}

async function fetchPool() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const json = await res.json();
  return json.data
    .filter((m) => {
      const id = m.id;
      if (!m.architecture?.input_modalities?.includes('image')) return false;
      if (id.includes(':batch') || id.startsWith('~')) return false;
      // Image GENERATION models are not vision-language models; asking one to
      // critique a screenshot returns art, not an opinion.
      if (/image-gen|tts|whisper|stable-diffusion|flux|sd3|dall|ideogram|recraft|-image$/.test(id)) return false;
      return /flash|mini|lite|glm|gemini-3|qwen3|step|seed|mimo|nemotron|granite/.test(id);
    })
    .map((m) => m.id)
    .sort();
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

Return ONLY a JSON array of exactly 5 objects with keys: title, where, problem, why, fix. No prose, no markdown fence.`;

const model = String(arg('model', ''));
if (model === '') throw new Error('review: --model is required (see --list)');
const screens = String(arg('screens', DEFAULT_SCREENS.join(',')))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const shotsDir = resolve(String(arg('shots', '.shots/final4')));

await mkdir(OUT_DIR, { recursive: true });

const content = [{ type: 'text', text: PROMPT }];
const used = [];
for (const screen of screens) {
  const file = resolve(shotsDir, `${screen}.png`);
  try {
    const sized = await reviewSized(file);
    const b64 = await readFile(sized);
    used.push(screen);
    content.push({ type: 'text', text: `Screenshot: ${screen}` });
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64.toString('base64')}` } });
  } catch {
    console.error(`review: no capture for "${screen}" in ${shotsDir} — skipping`);
  }
}
if (used.length === 0) throw new Error(`review: none of [${screens}] exist in ${shotsDir}`);

console.error(`review: asking ${model} about [${used.join(', ')}]…`);

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://shoemoney.ai',
    'X-Title': 'smduel-review-loop',
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content }],
    // Temperature is left at the provider default. We want this model's actual
    // opinion, not a sampled one; and the JSON contract in the prompt is tight
    // enough that a low temperature buys nothing.
    // DeepSeek's iteration-4 reply was cut off mid-string inside the fifth
    // object at 4000 tokens, which made the whole review unparseable. 5 detailed
    // findings plus a preamble is a lot of text; 9000 leaves room for a model
    // that thinks out loud before it answers.
    max_tokens: 9000,
  }),
});

if (!res.ok) {
  const body = await res.text();
  throw new Error(`review: ${res.status} ${res.statusText}\n${body.slice(0, 800)}`);
}
const json = await res.json();
const raw = json.choices?.[0]?.message?.content ?? '';

/** Extracts the JSON array from a model reply that may or may not have fenced it. */
function parseFindings(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`no JSON array in reply:\n${text.slice(0, 500)}`);
  return JSON.parse(candidate.slice(start, end + 1));
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
      screens: used,
      at: new Date().toISOString(),
      usage: json.usage ?? null,
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
