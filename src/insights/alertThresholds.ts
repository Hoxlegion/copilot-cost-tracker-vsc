/**
 * Single source of truth for alert threshold defaults and insight display constants.
 * Imported by both `database/metrics.ts` (metric computation) and
 * `insights/insightEngine.ts` (alert rendering) so defaults are never duplicated.
 */

export interface AlertThresholdDefaults {
  microTurnGapMs: number;
  microTurnMinCount: number;
  microTurnMaxOutputTokens: number;
  rawPasteMinInputTokens: number;
  premiumMisallocationMinCredits: number;
  premiumMisallocationMaxOutputTokens: number;
  agentSprawlMinInputTokens: number;
}

/** Default per-turn threshold values used when computing alert metrics. */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholdDefaults = {
  microTurnGapMs: 120_000,
  microTurnMinCount: 5,
  microTurnMaxOutputTokens: 200,
  rawPasteMinInputTokens: 15_000,
  premiumMisallocationMinCredits: 2,
  premiumMisallocationMaxOutputTokens: 100,
  agentSprawlMinInputTokens: 80_000,
};

/** Turns averaging more than this many output tokens are paying for narration. */
export const HIGH_VERBOSITY_AVG_OUTPUT_TOKENS = 600;
/** A session accumulating more than this many input tokens carries dead weight. */
export const CONTEXT_BLOAT_SESSION_INPUT_TOKENS = 40_000;
/** Idle gaps longer than this likely bust the Copilot cache TTL. */
export const CACHE_DECAY_IDLE_GAP_MS = 5 * 60 * 1000;

/** Default lookback window (hours) for dashboard alerts. */
export const DEFAULT_ALERT_WINDOW_HOURS = 24;
