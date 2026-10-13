import type { Database } from "sql.js";
import type { AlertMetrics, AlertThresholdConfig, InsightMetrics, CacheSavingsMetrics, AlertMetricAccumulator } from "./types";
import type { TurnSource } from "../parser/types";
import { DEFAULT_ALERT_THRESHOLDS } from "../insights/alertThresholds";
import { UNCACHED_INPUT_SQL } from "./queries";

export function getAlertThresholdConfig(thresholds?: Partial<AlertThresholdConfig>): AlertThresholdConfig {
  return {
    microTurnGapMs: thresholds?.microTurnGapMs ?? DEFAULT_ALERT_THRESHOLDS.microTurnGapMs,
    microTurnMinCount: thresholds?.microTurnMinCount ?? DEFAULT_ALERT_THRESHOLDS.microTurnMinCount,
    microTurnMaxOutputTokens: thresholds?.microTurnMaxOutputTokens ?? DEFAULT_ALERT_THRESHOLDS.microTurnMaxOutputTokens,
    rawPasteMinInputTokens: thresholds?.rawPasteMinInputTokens ?? DEFAULT_ALERT_THRESHOLDS.rawPasteMinInputTokens,
    premiumMisallocationMinCredits: thresholds?.premiumMisallocationMinCredits ?? DEFAULT_ALERT_THRESHOLDS.premiumMisallocationMinCredits,
    premiumMisallocationMaxOutputTokens: thresholds?.premiumMisallocationMaxOutputTokens ?? DEFAULT_ALERT_THRESHOLDS.premiumMisallocationMaxOutputTokens,
    agentSprawlMinInputTokens: thresholds?.agentSprawlMinInputTokens ?? DEFAULT_ALERT_THRESHOLDS.agentSprawlMinInputTokens,
  };
}

interface AlertMetricRow {
  sessionId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  credits: number;
  /** Prompt size of the session's previous request in the window, or null for its first one. */
  previousPrompt: number | null;
}

function applyAlertMetricRow(
  acc: AlertMetricAccumulator,
  row: AlertMetricRow,
  cfg: AlertThresholdConfig
): void {
  const { sessionId, timestamp, inputTokens, outputTokens, cachedTokens, credits, previousPrompt } = row;

  const totalInput = inputTokens + cachedTokens;
  if (totalInput >= cfg.agentSprawlMinInputTokens && totalInput > acc.massiveContextMaxInput) {
    acc.massiveContextMaxInput = totalInput;
  }

  // `inputTokens` is the uncached part of the prompt. Only the growth since the previous request
  // is new content; the rest is a cache warm-up (first request, resume, model switch, compaction).
  const newInput = previousPrompt === null ? 0 : Math.min(inputTokens, Math.max(0, totalInput - previousPrompt));
  if (newInput >= cfg.rawPasteMinInputTokens && newInput > acc.rawPasteMaxNetInput) {
    acc.rawPasteMaxNetInput = newInput;
  }

  if (credits >= cfg.premiumMisallocationMinCredits && outputTokens <= cfg.premiumMisallocationMaxOutputTokens) {
    acc.premiumMisallocationCount++;
    acc.premiumMisallocationCreditsTotal += credits;
  }

  const gap = timestamp - acc.previousTimestamp;
  if (acc.previousSessionId === sessionId && gap >= 0 && gap <= cfg.microTurnGapMs && outputTokens <= cfg.microTurnMaxOutputTokens) {
    acc.microTurnStreak++;
    acc.microTurnStreakOutput += outputTokens;
    if (acc.microTurnStreak > acc.microTurnCount) {
      acc.microTurnCount = acc.microTurnStreak;
      acc.microTurnOutputTotal = acc.microTurnStreakOutput;
    }
  } else {
    acc.microTurnStreak = 0;
    acc.microTurnStreakOutput = 0;
  }

  acc.previousSessionId = sessionId;
  acc.previousTimestamp = timestamp;
}

export function getInsightMetrics(db: Database, days: number = 30, source?: TurnSource): InsightMetrics {
  const safeDays = clampIntForMetrics(days, 1, 3650);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const bindings = { ":since": since, ":source": source ?? null };

  const totalsStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0),
      COALESCE(SUM(output_tokens), 0),
      COALESCE(SUM(cached_tokens), 0),
      COALESCE(SUM(CASE WHEN status = 'error' THEN request_count ELSE 0 END), 0),
      COALESCE(SUM(request_count), 0)
    FROM turns
    WHERE timestamp >= :since
      AND (:source IS NULL OR source = :source)
  `);
  totalsStmt.bind(bindings);

  let totalInputTokens = 0, totalOutputTokens = 0, totalCachedTokens = 0, errorTurns = 0, totalTurns = 0;
  if (totalsStmt.step()) {
    const row = totalsStmt.get();
    totalInputTokens = (row[0] as number) || 0;
    totalOutputTokens = (row[1] as number) || 0;
    totalCachedTokens = (row[2] as number) || 0;
    errorTurns = (row[3] as number) || 0;
    totalTurns = (row[4] as number) || 0;
  }
  totalsStmt.free();

  const totalBillableInput = totalInputTokens + totalCachedTokens;
  const cacheHitPct = totalBillableInput > 0
    ? Math.round((totalCachedTokens / totalBillableInput) * 1000) / 10
    : 0;

  const dailyStmt = db.prepare(`
    SELECT
      date(timestamp / 1000, 'unixepoch', 'localtime') as period,
      SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens)
    FROM turns
    WHERE timestamp >= :since
      AND (:source IS NULL OR source = :source)
    GROUP BY period ORDER BY period ASC
  `);
  dailyStmt.bind(bindings);

  const ioRatioDays: InsightMetrics["ioRatioDays"] = [];
  while (dailyStmt.step()) {
    const row = dailyStmt.get();
    ioRatioDays.push({
      period: row[0] as string,
      inputTokens: (row[1] as number) || 0,
      outputTokens: (row[2] as number) || 0,
      cachedTokens: (row[3] as number) || 0,
    });
  }
  dailyStmt.free();

  return { totalInputTokens, totalOutputTokens, totalCachedTokens, errorTurns, totalTurns, cacheHitPct, ioRatioDays };
}

export function getAlertMetrics(
  db: Database,
  sinceMs: number,
  thresholds?: Partial<AlertThresholdConfig>,
  source?: TurnSource,
): AlertMetrics {
  const cfg = getAlertThresholdConfig(thresholds);

  // Single-pass query: compute verbosity, peak context, idle gaps, and per-row threshold
  // metrics in one scan using window functions. These heuristics assume one row per model
  // request, so CLI rows that combine several requests are skipped. Calls without a chat
  // session (Next Edit Suggestions, background helpers) are not part of any conversation.
  const stmt = db.prepare(`
    SELECT
      session_id,
      timestamp,
      ${UNCACHED_INPUT_SQL} AS input_tokens,
      output_tokens,
      cached_tokens,
      credits,
      LAG(${UNCACHED_INPUT_SQL} + cached_tokens) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_prompt,
      LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_timestamp
    FROM turns
    WHERE timestamp >= :since
      AND (:source IS NULL OR source = :source)
      AND request_count = 1
      AND session_id <> 'unknown'
    ORDER BY session_id ASC, timestamp ASC
  `);
  stmt.bind({ ":since": sinceMs, ":source": source ?? null });

  let totalOutputTokens = 0;
  let turnsWithOutput = 0;
  let peakContextTokens = 0;
  let maxIdleGapMs = 0;

  const acc: AlertMetricAccumulator = {
    microTurnCount: 0,
    microTurnOutputTotal: 0,
    microTurnStreak: 0,
    microTurnStreakOutput: 0,
    rawPasteMaxNetInput: 0,
    premiumMisallocationCount: 0,
    premiumMisallocationCreditsTotal: 0,
    massiveContextMaxInput: 0,
    previousSessionId: null,
    previousTimestamp: 0,
  };

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const outputTokens = (row.output_tokens as number) || 0;
    const inputTokens = (row.input_tokens as number) || 0;
    const cachedTokens = (row.cached_tokens as number) || 0;
    const prevPrompt = row.prev_prompt as number | null;
    const prevTimestamp = row.prev_timestamp as number | null;
    const timestamp = (row.timestamp as number) || 0;

    // Verbosity
    if (outputTokens > 0) {
      totalOutputTokens += outputTokens;
      turnsWithOutput++;
    }

    // Context re-sent by a single request
    peakContextTokens = Math.max(peakContextTokens, inputTokens + cachedTokens);

    // Max idle gap
    if (prevTimestamp != null) {
      const gap = timestamp - prevTimestamp;
      if (gap > maxIdleGapMs) {
        maxIdleGapMs = gap;
      }
    }

    // Threshold alert metrics (reuse existing accumulator logic)
    applyAlertMetricRow(acc, {
      sessionId: (row.session_id as string) ?? "",
      timestamp,
      inputTokens,
      outputTokens,
      cachedTokens,
      credits: (row.credits as number) || 0,
      previousPrompt: prevPrompt ?? null,
    }, cfg);
  }
  stmt.free();

  if (acc.microTurnCount < cfg.microTurnMinCount) {
    acc.microTurnCount = 0;
    acc.microTurnOutputTotal = 0;
  }

  return {
    avgOutputTokensToday: turnsWithOutput > 0 ? totalOutputTokens / turnsWithOutput : 0,
    turnsToday: turnsWithOutput,
    peakContextTokens,
    maxIdleGapMs,
    microTurnCount: acc.microTurnCount,
    microTurnAvgOutput: acc.microTurnCount > 0 ? Math.round(acc.microTurnOutputTotal / acc.microTurnCount) : 0,
    rawPasteMaxNetInput: acc.rawPasteMaxNetInput,
    premiumMisallocationCount: acc.premiumMisallocationCount,
    premiumMisallocationAvgCredits: acc.premiumMisallocationCount > 0
      ? acc.premiumMisallocationCreditsTotal / acc.premiumMisallocationCount
      : 0,
    massiveContextMaxInput: acc.massiveContextMaxInput,
  };
}

export function getCacheSavingsMetrics(
  db: Database,
  sinceMs: number,
  workspace?: string,
  calculateSavingsCost?: (modelFamily: string, writeTokens: number, readTokens: number) => number,
  source?: TurnSource,
): CacheSavingsMetrics {
  const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;

  const stmt = db.prepare(`
    SELECT
      model_family,
      SUM(COALESCE(cache_write_tokens, 0)) as total_write_tokens,
      SUM(COALESCE(cached_tokens, 0)) as total_read_tokens
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
      AND (:source IS NULL OR source = :source)
    GROUP BY model_family
    ORDER BY total_write_tokens + total_read_tokens DESC
  `);
  stmt.bind({ ":since": safeSince, ":workspace": workspace ?? null, ":source": source ?? null });

  const byModel: CacheSavingsMetrics["byModel"] = [];
  let totalWriteTokens = 0;
  let totalReadTokens = 0;
  let totalSavingsCostUsd = 0;

  while (stmt.step()) {
    const row = stmt.getAsObject();
    const modelFamily = row.model_family as string;
    const writeTokens = (row.total_write_tokens as number) || 0;
    const readTokens = (row.total_read_tokens as number) || 0;

    totalWriteTokens += writeTokens;
    totalReadTokens += readTokens;

    const savingsCostUsd = calculateSavingsCost
      ? calculateSavingsCost(modelFamily, writeTokens, readTokens)
      : 0;
    totalSavingsCostUsd += savingsCostUsd;

    byModel.push({
      modelFamily,
      cacheWriteTokens: writeTokens,
      cacheReadTokens: readTokens,
      savingsCostUsd,
      savingsCredits: savingsCostUsd * 100,
      percentage: 0,
    });
  }
  stmt.free();

  // Compute percentage share per model
  for (const entry of byModel) {
    entry.percentage = totalSavingsCostUsd > 0 ? (entry.savingsCostUsd / totalSavingsCostUsd) * 100 : 0;
  }

  return {
    totalCacheWriteTokens: totalWriteTokens,
    totalCacheReadTokens: totalReadTokens,
    totalSavingsCostUsd,
    totalSavingsCredits: totalSavingsCostUsd * 100,
    byModel,
  };
}

function clampIntForMetrics(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
