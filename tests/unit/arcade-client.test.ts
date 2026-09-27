/**
 * Proves `@/arcade/client`'s two-request submit flow (order, token
 * threading, failure containment) with `fetch` faked, and proves
 * `arcadeScoringEnabled`'s gate for the real host, the `?arcade=1` escape
 * hatch, and the off case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcadeScoringEnabled, submitArcadeScore, type ArcadeRunSubmission } from '@/arcade/client';

const SUBMISSION: ArcadeRunSubmission = { name: 'Test Driver', score: 1500, wave: 3, kills: 3, headshots: 1, duration: 60 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('submitArcadeScore(): the two-request flow, fetch faked', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('BroadcastChannel', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts /runs then /scores, in that order, threading request 1\'s runToken into request 2\'s body', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { runToken: 'abc-run-token' }))
      .mockResolvedValueOnce(jsonResponse(201, { accepted: true, rank: 4 }));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: true, rank: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/games/smduel/runs');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/games/smduel/scores');
    const scoresBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as { body: string }).body) as { runToken: string };
    expect(scoresBody.runToken).toBe('abc-run-token');
  });

  it('a non-ok request 1 surfaces an error and never fires request 2, even carrying a well-formed runToken', async () => {
    // A well-formed runToken in the body, on a 500 status - isolates the
    // ok-check itself from the separate "missing runToken" check below.
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { runToken: 'well-formed-but-status-500' }));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: false, failure: { kind: 'run-refused', status: 500 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a malformed request-1 body with no runToken surfaces an error and never fires request 2', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { notARunToken: true }));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: false, failure: { kind: 'no-token' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a rejected request 2 reports the score-refused status and the server\'s OWN message verbatim, never wording invented here', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { runToken: 'abc-run-token' }))
      .mockResolvedValueOnce(jsonResponse(400, { error: 'Headshots cannot exceed kills' }));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'score-refused', status: 400, serverMessage: 'Headshots cannot exceed kills' },
    });
  });

  it('a request-2 rejection with no server message leaves serverMessage null, so the UI falls back to its own wording', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { runToken: 'abc-run-token' }))
      .mockResolvedValueOnce(jsonResponse(503, {}));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: false, failure: { kind: 'score-refused', status: 503, serverMessage: null } });
  });

  it('an unreachable server is reported as unreachable, not as a refusal', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: false, failure: { kind: 'unreachable' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 200 that says accepted:false is not treated as an accepted submission', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { runToken: 'abc-run-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { accepted: false, reason: 'board_changed' }));

    const result = await submitArcadeScore(SUBMISSION);

    expect(result).toEqual({ ok: false, failure: { kind: 'not-accepted' } });
  });
});

describe('arcadeScoringEnabled(): the gate predicate', () => {
  it('is true on the real arcade host', () => {
    expect(arcadeScoringEnabled({ hostname: 'arcade.shoemoney.com', search: '' })).toBe(true);
  });

  it('is true with ?arcade=1, parsed via URLSearchParams (not a substring match)', () => {
    expect(arcadeScoringEnabled({ hostname: 'localhost', search: '?arcade=1' })).toBe(true);
    expect(arcadeScoringEnabled({ hostname: 'localhost', search: '?arcade=100' })).toBe(false);
  });

  it('is false off the arcade host with no arcade=1 param', () => {
    expect(arcadeScoringEnabled({ hostname: 'localhost', search: '' })).toBe(false);
  });
});
