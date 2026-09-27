/**
 * The only file in the repo that calls the arcade leaderboard's SCORE API
 * (`/api/games/smduel/{runs,scores}` on `SMA-arcade`'s own server, see
 * `/Users/shoemoney/Projects/SMA-arcade/api/server.mjs`). `@/app`'s bundled-
 * asset loads (the atlas image, the sprite shader) call `fetch` too, for a
 * completely unrelated reason - they are not this file's concern and this
 * file does not touch them.
 *
 * Two-request v1 flow: mint a short-lived `runToken` when the submit screen
 * OPENS (never at match start - it only has to live for seconds), then post
 * the run's numbers against that token. Either request can fail; a failed
 * first request must never let the second one fire with garbage.
 */
import type { ArcadeScorePayload } from '@/arcade/score';

const RUNS_URL = '/api/games/smduel/runs';
const SCORES_URL = '/api/games/smduel/scores';
const BROADCAST_CHANNEL_NAME = 'shoemoney-arcade-scores';

/**
 * True on the real arcade host, OR when `?arcade=1` is present - the escape
 * hatch that lets the author verify against a local API before deploying.
 * Parsed via `URLSearchParams`, never a substring match (an unrelated
 * `?arcade=100` or `?notarcade=1` must not flip this on by accident).
 */
export function arcadeScoringEnabled(env: { readonly hostname: string; readonly search: string }): boolean {
  if (env.hostname === 'arcade.shoemoney.com') return true;
  return new URLSearchParams(env.search).get('arcade') === '1';
}

export interface ArcadeRunSubmission extends ArcadeScorePayload {
  readonly name: string;
}

/**
 * Why a tagged failure rather than a ready-made sentence: display wording
 * lives in rulesets/classic/strings.json and reaches the player through
 * `@/ui/strings`'s `t()`, which is the whole point of that seam (see its
 * module header). A network module that returned English prose would put
 * player-visible text outside the table, where `tests/unit/strings.test.ts`'s
 * scanner cannot see it either, since that scanner walks `src/ui/**` and
 * `src/app.ts` and not this directory. `serverMessage` is the one exception
 * and is deliberately NOT wording this repo owns: it is the arcade server's
 * own rejection reason, passed through verbatim as a `t()` parameter.
 */
export type ArcadeSubmitFailure =
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'run-refused'; readonly status: number }
  | { readonly kind: 'no-token' }
  | { readonly kind: 'score-refused'; readonly status: number; readonly serverMessage: string | null }
  | { readonly kind: 'not-accepted' };

export type ArcadeSubmitResult =
  | { readonly ok: true; readonly rank: number | null }
  | { readonly ok: false; readonly failure: ArcadeSubmitFailure };

type MintResult = { readonly ok: true; readonly runToken: string } | { readonly ok: false; readonly failure: ArcadeSubmitFailure };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function mintRunToken(): Promise<MintResult> {
  let response: Response;
  try {
    response = await fetch(RUNS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    return { ok: false, failure: { kind: 'unreachable' } };
  }
  if (!response.ok) return { ok: false, failure: { kind: 'run-refused', status: response.status } };
  const body = await readJson(response);
  const runToken = (body as { readonly runToken?: unknown } | null)?.runToken;
  if (typeof runToken !== 'string') return { ok: false, failure: { kind: 'no-token' } };
  return { ok: true, runToken };
}

/** Guarded: `BroadcastChannel` doesn't exist in every environment. */
function announceScoreSubmitted(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  channel.postMessage({ kind: 'score-submitted' });
  channel.close();
}

/**
 * Runs the full two-request flow. Request 2 is NEVER sent unless request 1
 * came back `ok` with a string `runToken` - a non-ok response or a missing/
 * non-string token from request 1 is surfaced as an error here, straight
 * through, rather than letting a broken run token reach the scores endpoint.
 */
export async function submitArcadeScore(submission: ArcadeRunSubmission): Promise<ArcadeSubmitResult> {
  const minted = await mintRunToken();
  if (!minted.ok) return { ok: false, failure: minted.failure };

  let response: Response;
  try {
    response = await fetch(SCORES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runToken: minted.runToken, ...submission }),
    });
  } catch {
    return { ok: false, failure: { kind: 'unreachable' } };
  }
  const body = await readJson(response);
  if (!response.ok) {
    const message = (body as { readonly error?: unknown } | null)?.error;
    return {
      ok: false,
      failure: { kind: 'score-refused', status: response.status, serverMessage: typeof message === 'string' ? message : null },
    };
  }
  const accepted = body as { readonly accepted?: unknown; readonly rank?: unknown } | null;
  if (accepted?.accepted !== true) return { ok: false, failure: { kind: 'not-accepted' } };

  announceScoreSubmitted();
  return { ok: true, rank: typeof accepted.rank === 'number' ? accepted.rank : null };
}
