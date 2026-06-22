/**
 * Shared efficiency scoring used by both the Efficiency Grade card and the
 * Optimization Score bar so they always agree.
 *
 * Design notes (calibrated for agentic Copilot usage):
 *  - Cache hit rate is normally high (85-95%) because every turn re-reads the
 *    cached conversation, so we only reward the upper band and stop crediting
 *    below 55%.
 *  - Context size: a smaller average working context is cheaper and faster.
 *  - Input:Output uses NET (non-cached) input vs output. Using cache-inflated
 *    input made the ratio astronomically high for everyone and unfairly tanked
 *    the score; net input reflects how much *fresh* context you send per result.
 */

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface EfficiencyInputs {
  /** Cache hit rate as a percentage (0-100). */
  cacheHitPct: number;
  /** Average working-context size in tokens across sessions in range. */
  avgContextTokens: number;
  /** Net (non-cached) input tokens in range. */
  netInputTokens: number;
  /** Output tokens in range. */
  outputTokens: number;
}

export interface EfficiencyResult {
  score: number;
  grade: Grade;
  cacheScore: number;
  contextScore: number;
  ioScore: number;
  /** Net input:output ratio (net input / output). */
  ioRatio: number;
  weights: { cache: number; context: number; io: number };
}

const WEIGHTS = { cache: 35, context: 35, io: 30 } as const;

/** Full credit at/below `full`, zero at/above `zero`, linear in between. */
function rampDown(value: number, full: number, zero: number, weight: number): number {
  if (value <= full) return weight;
  if (value >= zero) return 0;
  return weight * (1 - (value - full) / (zero - full));
}

/** Zero credit at/below `zero`, full at/above `full`, linear in between. */
function rampUp(value: number, zero: number, full: number, weight: number): number {
  if (value >= full) return weight;
  if (value <= zero) return 0;
  return weight * ((value - zero) / (full - zero));
}

export function gradeFromScore(score: number): Grade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function computeEfficiency(input: EfficiencyInputs): EfficiencyResult {
  const cacheScore = rampUp(input.cacheHitPct, 55, 90, WEIGHTS.cache);
  const contextScore = rampDown(input.avgContextTokens, 8000, 60000, WEIGHTS.context);

  const ioRatio = input.outputTokens > 0 ? input.netInputTokens / input.outputTokens : 0;
  const ioScore = input.outputTokens > 0 ? rampDown(ioRatio, 3, 15, WEIGHTS.io) : 0;

  const score = Math.round(cacheScore + contextScore + ioScore);
  return {
    score,
    grade: gradeFromScore(score),
    cacheScore,
    contextScore,
    ioScore,
    ioRatio,
    weights: { ...WEIGHTS },
  };
}
