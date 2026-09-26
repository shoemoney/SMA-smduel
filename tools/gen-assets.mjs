#!/usr/bin/env node
// Parallel Replicate asset generator. Submits ALL predictions up front, then polls.
// usage: node tools/gen-assets.mjs <manifest.json> [--out assets/raw] [--concurrency 50]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error('REPLICATE_API_TOKEN missing'); process.exit(1); }

const args = process.argv.slice(2);
const manifestPath = args[0];
const outDir = resolve(args[args.indexOf('--out') + 1] ?? 'assets/raw');
const CONCURRENCY = Number(args[args.indexOf('--concurrency') + 1]) || 50;

const MODELS = {
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux-dev': 'black-forest-labs/flux-dev',
  'flux-pro': 'black-forest-labs/flux-1.1-pro',
  'recraft-svg': 'recraft-ai/recraft-v3-svg',
  'nano-banana': 'google/nano-banana',
};

const api = (path, init = {}) =>
  fetch(`https://api.replicate.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

async function submit(job) {
  const model = MODELS[job.model ?? 'flux-schnell'] ?? job.model;
  const input = {
    prompt: job.prompt,
    aspect_ratio: job.aspect_ratio ?? '1:1',
    output_format: job.output_format ?? 'png',
    ...(job.model === 'recraft-svg' ? {} : { num_outputs: 1, go_fast: job.go_fast ?? true }),
    ...(job.seed != null ? { seed: job.seed } : {}),
    ...(job.extra ?? {}),
  };
  const res = await api(`/models/${model}/predictions`, { method: 'POST', body: JSON.stringify({ input }) });
  const body = await res.json();
  if (!res.ok) return { ...job, error: body?.detail ?? `HTTP ${res.status}`, id: null };
  return { ...job, id: body.id, status: body.status };
}

async function poll(job) {
  if (!job.id) return job;
  for (let i = 0; i < 180; i++) {
    const res = await api(`/predictions/${job.id}`);
    const body = await res.json();
    if (body.status === 'succeeded') return { ...job, status: 'succeeded', output: body.output };
    if (body.status === 'failed' || body.status === 'canceled')
      return { ...job, status: body.status, error: body.error ?? body.status };
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ...job, status: 'timeout', error: 'poll timeout 360s' };
}

async function download(job) {
  if (job.status !== 'succeeded') return job;
  const urls = Array.isArray(job.output) ? job.output : [job.output];
  const files = [];
  for (const [i, url] of urls.entries()) {
    if (typeof url !== 'string') continue;
    const ext = job.output_format ?? (job.model === 'recraft-svg' ? 'svg' : 'png');
    const name = urls.length > 1 ? `${job.id_name}-${i}.${ext}` : `${job.id_name}.${ext}`;
    const dest = resolve(outDir, name);
    await mkdir(dirname(dest), { recursive: true });
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(dest, buf);
    files.push({ path: dest, bytes: buf.length });
  }
  return { ...job, files };
}

// throttled map: keeps CONCURRENCY in flight, never serialises
async function pooled(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { ...items[i], status: 'error', error: String(e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const jobs = manifest.assets ?? manifest;
console.error(`submitting ${jobs.length} predictions, ${CONCURRENCY}-wide...`);

const submitted = await pooled(jobs, submit);
const failedSubmit = submitted.filter(j => !j.id);
if (failedSubmit.length) console.error(`submit failures: ${failedSubmit.length}`);

const polled = await pooled(submitted.filter(j => j.id), poll);
const done = await pooled(polled, download);

const ok = done.filter(j => j.status === 'succeeded');
const bad = [...failedSubmit, ...done.filter(j => j.status !== 'succeeded')];
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, '_result.json'), JSON.stringify({ ok: ok.length, failed: bad.length, assets: done, failedSubmit }, null, 2));
console.error(`done: ${ok.length} ok, ${bad.length} failed -> ${outDir}/_result.json`);
for (const j of bad) console.error(`  FAIL ${j.id_name}: ${j.error}`);
console.log(JSON.stringify({ ok: ok.length, failed: bad.length, files: ok.flatMap(j => (j.files ?? []).map(f => f.path)) }, null, 2));
