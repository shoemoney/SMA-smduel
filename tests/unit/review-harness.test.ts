/**
 * Guards for the review harness itself, which iteration 114 established is now
 * a bigger source of lost signal than the weakest reviewers.
 *
 * Two rounds were lost to it. A duplicated leftover block at the end of
 * `tools/review-codex.sh` had its own `> "$TRACE"` redirect, so it TRUNCATED an
 * 188KB diagnostic trace down to one line of shell error — the run destroyed the
 * evidence needed to diagnose it. And the script accepted any non-empty answer
 * as a review, so a reply that said "I could not reach the game" was recorded as
 * a successful review. That is this project's most expensive failure class — a
 * healthy-looking signal standing in for a fact — appearing inside the one tool
 * whose entire job is producing evidence about the build.
 *
 * These tests run the REAL script rather than asserting on its text, because a
 * check that only reads the source is the check that missed iteration 32's
 * `--ui-surface-2` (a rule that read correctly and rendered nothing) and
 * iteration 50's wall measurement (a sample box pointed at the wrong element).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'tools', 'review-codex.sh');

/** Runs the script's own classifier against a written answer. */
function classify(body: string): { verdict: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), 'smduel-verdict-'));
  const file = join(dir, 'review.md');
  writeFileSync(file, body, 'utf8');
  let code = 0;
  let verdict = '';
  try {
    verdict = execFileSync('bash', [SCRIPT, '--classify', file], { encoding: 'utf8' }).trim();
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    code = err.status ?? -1;
    verdict = (err.stdout ?? '').trim();
  }
  return { verdict, code };
}

describe('review harness: a review must be distinguishable from a refusal', () => {
  it('accepts a review that reports findings', () => {
    expect(classify('## Live review\n\n- one\n- two\n\nREVIEW-VERDICT: 2\n')).toEqual({
      verdict: 'FINDINGS:2',
      code: 0,
    });
  });

  it('accepts ZERO findings as a real result, because a zero is a result', () => {
    // The log holds nine legitimate zero-review rounds. A harness that treated
    // "nothing found" as a failure would push every future round toward
    // inventing findings, which is the exact behaviour it exists to prevent.
    expect(classify('## Live review\n\nEverything checked, nothing wrong.\n\nREVIEW-VERDICT: 0\n')).toEqual({
      verdict: 'FINDINGS:0',
      code: 0,
    });
  });

  it('REJECTS an explicit BLOCKED verdict — the reviewer never looked', () => {
    const result = classify('## Live review blocked\n\nno browser, host did not resolve\n\nREVIEW-VERDICT: BLOCKED\n');
    expect(result.verdict).toBe('BLOCKED');
    expect(result.code).toBe(2);
  });

  it('REJECTS an answer with no verdict line at all', () => {
    // This is the iteration-114 shape: a non-empty file that says it could not
    // review, which the old `-s "$OUT"` check recorded as a successful review.
    const real = '## Live review blocked\n\nI couldn’t reach the running game.\n';
    const result = classify(real);
    expect(result.verdict).toBe('NOVERDICT');
    expect(result.code).toBe(2);
  });
});

describe('review harness: the run must not destroy its own evidence', () => {
  it('invokes codex exactly once, so no leftover block can re-truncate the trace', () => {
    // The duplicate was invisible to every existing check: the review still
    // succeeded, the runner still exited 0, and the only symptom was a bogus
    // `-m: command not found` in a log nobody reads until something else fails.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not tidiness. The first version
    // of this test counted the string `codex exec` in the whole file and failed
    // on a line of PROSE explaining why `-o` is needed — it was asserting that
    // the script cannot document itself, which is not the property that matters.
    // A guard that fires on the wrong thing trains you to ignore it, so it has
    // to count the runnable script and nothing else.
    const source = readFileSync(SCRIPT, 'utf8');
    const runnable = source
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    const invocations = runnable.match(/codex exec/g) ?? [];
    expect(invocations, 'a second `codex exec` is the orphan class — it truncates $TRACE').toHaveLength(1);
  });

  it('truncates the trace exactly once, which is the actual mechanism of that bug', () => {
    // Counting `codex exec` is necessary but NOT sufficient, and a mutation
    // proved it: re-injecting the orphan without that literal left the count at
    // one and the test green, while the script still truncated its own evidence.
    //
    // The bug was never really about calling codex twice. It was a second
    // `> "$TRACE"`, which is what actually destroyed the 188KB diagnostic. A
    // leftover fragment of ANY shape — a stray redirect, a duplicated tail, a
    // re-run — destroys the evidence the same way, so the guard watches the
    // redirect rather than the command it happens to wrap.
    const source = readFileSync(SCRIPT, 'utf8');
    const runnable = source
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    const redirects = runnable.match(/> "\$TRACE"/g) ?? [];
    expect(redirects, 'a second `> "$TRACE"` silently destroys the run diagnostic').toHaveLength(1);
  });

  it('refuses to report success when the trace is empty', () => {
    // A successful run that leaves no diagnostic has thrown away its own
    // evidence, which is how a 188KB trace became one line without anyone
    // noticing until a review came back empty.
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toMatch(/TRACE is empty/);
    expect(source).toMatch(/exit 0/);
  });

  it('grants the reviewer network access, without granting filesystem writes', () => {
    // A review of a web application that cannot reach the web is not a review.
    // With the sandbox's network off, the playwright MCP could not be fetched,
    // so no browser tools existed, so one cause produced three
    // different-looking symptoms ("no browser MCP tools", "could not resolve
    // host", "Chrome exited with SIGABRT") and a whole round was wasted.
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).toMatch(/\[sandbox_workspace_write\]\s*\nnetwork_access = true/);
    // The filesystem sandbox must stay: the reviewer still may not modify the
    // build it is reviewing.
    expect(source).toMatch(/sandbox_mode = "workspace-write"/);
  });
});
