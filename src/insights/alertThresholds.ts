/**
 * Single source of truth for alert threshold defaults and insight display constants.
 * Imported by both `database/metrics.ts` (metric computation) and
 * `insights/insightEngine.ts` (alert rendering) so defaults are never duplicated.
 *
 * Calibrated for agentic chat: each request re-sends the whole conversation, a fresh chat
 * already starts at roughly 20-50K tokens, agent tool loops make many short requests, and
 * output tokens include reasoning.
 */

import { CONTEXT_TIER_THRESHOLDS } from "../shared/contextTiers";

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
  rawPasteMinInputTokens: 50_000,
  premiumMisallocationMinCredits: 5,
  premiumMisallocationMaxOutputTokens: 50,
  agentSprawlMinInputTokens: CONTEXT_TIER_THRESHOLDS.critical,
};

/** Requests averaging more output tokens (reasoning included) than this are unusually verbose. */
export const HIGH_VERBOSITY_AVG_OUTPUT_TOKENS = 1_500;
/** A session whose requests carry more context than this has entered the heavy tier. */
export const CONTEXT_BLOAT_REQUEST_TOKENS = CONTEXT_TIER_THRESHOLDS.heavy;
/** Measured on Copilot Chat: the prompt cache usually survives 5-30 idle minutes and is gone after 30. */
export const CACHE_DECAY_IDLE_GAP_MS = 30 * 60 * 1000;

/** Default lookback window (hours) for dashboard alerts. */
export const DEFAULT_ALERT_WINDOW_HOURS = 24;
