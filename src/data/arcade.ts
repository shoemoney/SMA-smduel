/**
 * Typed loader for `rulesets/arcade/score.json` - the arcade leaderboard's
 * scoring weights. Deliberately its own tiny loader rather than a fold into
 * `@/data/rulesets`'s ten-file `RULESETS` aggregate: that aggregate's schemas
 * (`@/data/schema`) are all rulesets/classic/*.json, walked wholesale by
 * `tests/unit/fidelity-coverage.test.ts` for provenance coverage, and arcade
 * scoring has no 1985 provenance to claim (see score.json's own `_note`).
 * Validated ONCE at module load, same convention as `validateRulesets`, so a
 * malformed table fails at startup, not mid-run.
 */
import Ajv from 'ajv';
import type { ErrorObject, SchemaObject, ValidateFunction } from 'ajv';

import scoreJson from '@rulesets/arcade/score.json';

export interface ArcadeScoreWeights {
  readonly $schemaVersion: number;
  readonly _note?: string;
  readonly killPoints: number;
  readonly driverKillPoints: number;
  readonly opponentScaling: number;
  readonly parSecondsPerOpponent: number;
  readonly speedPoints: number;
  readonly maxScore: number;
}

const scoreSchema: SchemaObject = {
  type: 'object',
  properties: {
    $schemaVersion: { type: 'integer', minimum: 0 },
    _note: { type: 'string' },
    killPoints: { type: 'number' },
    driverKillPoints: { type: 'number' },
    opponentScaling: { type: 'number' },
    parSecondsPerOpponent: { type: 'number' },
    speedPoints: { type: 'number' },
    maxScore: { type: 'number' },
  },
  required: ['$schemaVersion', 'killPoints', 'driverKillPoints', 'opponentScaling', 'parSecondsPerOpponent', 'speedPoints', 'maxScore'],
  additionalProperties: false,
};

export class ArcadeScoreValidationError extends Error {
  override readonly name = 'ArcadeScoreValidationError';
  constructor(readonly problems: readonly string[]) {
    super(`score.json failed validation:\n  ${problems.join('\n  ')}`);
  }
}

let scoreValidator: ValidateFunction<ArcadeScoreWeights> | null = null;

function getScoreValidator(): ValidateFunction<ArcadeScoreWeights> {
  if (scoreValidator) return scoreValidator;
  const ajv = new Ajv({ allErrors: true, strict: true });
  scoreValidator = ajv.compile<ArcadeScoreWeights>(scoreSchema);
  return scoreValidator;
}

function describeScoreError(err: ErrorObject): string {
  const path = err.instancePath === '' ? '/' : err.instancePath;
  let detail = err.message ?? 'is invalid';
  if (err.keyword === 'additionalProperties' && typeof err.params['additionalProperty'] === 'string') {
    detail += ` ("${err.params['additionalProperty']}")`;
  }
  return `score.json:${path} ${detail}`;
}

function validateArcadeScore(input: unknown): ArcadeScoreWeights {
  const validate = getScoreValidator();
  if (!validate(input)) {
    const problems = (validate.errors ?? []).map(describeScoreError);
    throw new ArcadeScoreValidationError(problems.length > 0 ? problems : ['unknown schema error']);
  }
  return input;
}

/** The validated aggregate. ES module semantics guarantee this runs exactly once. */
const ARCADE_SCORE_WEIGHTS: ArcadeScoreWeights = validateArcadeScore(scoreJson);

export function arcadeScoreWeights(): ArcadeScoreWeights {
  return ARCADE_SCORE_WEIGHTS;
}
