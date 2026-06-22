import type { Database } from "sql.js";
import type { AlertMetrics, AlertThresholdConfig, InsightMetrics, CacheSavingsMetrics, AlertMetricAccumulator } from "./types";

export function getAlertThresholdConfig(thresholds?: Partial<AlertThresholdConfig>): AlertThresholdConfig {
  return {
    microTurnGapMs: thresholds?.microTurnGapMs ?? 120_000,
    microTurnMinCount: thresholds?.microTurnMinCount ?? 5,
    microTurnMaxOutputTokens: thresholds?.microTurnMaxOutputTokens ?? 200,
    rawPasteMinInputTokens: thresholds?.rawPasteMinInputTokens ?? 15_000,
    premiumMisallocationMinCredits: thresholds?.premiumMisallocationMinCredits ?? 2,
    premiumMisallocationMaxOutputTokens: thresholds?.premiumMisallocationMaxOutputTokens ?? 100,
    agentSprawlMinInputTokens: thresholds?.agentSprawlMinInputTokens ?? 80_000,
  };
}

function applyAlertMetricRow(
  acc: AlertMetricAccumulator,
  row: unknown[],
  cfg: AlertThresholdConfig
): void {
  const sessionId = (row[0] as string) ?? "";
  const timestamp = (row[1] as number) || 0;
  const inputTokens = (row[2] as number) || 0;
  const outputTokens = (row[3] as number) || 0;
  const cachedTokens = (row[4] as number) || 0;
  const credits = (row[5] as number) || 0;

  const totalInput = inputTokens + cachedTokens;
  if (totalInput > acc.massiveContextMaxInput) {
    acc.massiveContextMaxInput = totalInput;
  }

  // `inputTokens` is stored as the non-cached (net new) portion of the prompt, so it is
  // already the uncached input used for raw-paste detection.
  const netInput = Math.max(0, inputTokens);
  if (netInput >= cfg.rawPasteMinInputTokens && netInput > acc.rawPasteMaxNetInput) {
    acc.rawPasteMaxNetInput = netInput;
  }

  if (credits >= cfg.premiumMisallocationMinCredits && outputTokens <= cfg.premiumMisallocationMaxOutputTokens) {
    acc.premiumMisallocationCount++;
    acc.premiumMisallocationCreditsTotal += credits;
  }

  if (acc.previousSessionId === sessionId) {
    const gap = timestamp - acc.previousTimestamp;
    if (gap >= 0 && gap <= cfg.microTurnGapMs && outputTokens <= cfg.microTurnMaxOutputTokens) {
      acc.microTurnCount++;
      acc.microTurnOutputTotal += outputTokens;
    }
  }

  acc.previousSessionId = sessionId;
  acc.previousTimestamp = timestamp;
}

export function getInsightMetrics(db: Database, days: number = 30): InsightMetrics {
  const safeDays = clampIntForMetrics(days, 1, 3650);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const totalsStmt = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0),
      COALESCE(SUM(output_tokens), 0),
      COALESCE(SUM(cached_tokens), 0),
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0),
      COUNT(*)
    FROM turns WHERE timestamp >= :since
  `);
  totalsStmt.bind({ ":since": since });

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
      date(timestamp / 1000, 'unixepoch') as period,
      SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens)
    FROM turns WHERE timestamp >= :since
    GROUP BY period ORDER BY period ASC
  `);
  dailyStmt.bind({ ":since": since });

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
  thresholds?: Partial<AlertThresholdConfig>
): AlertMetrics {
  const cfg = getAlertThresholdConfig(thresholds);

  // Single-pass query: compute verbosity, session totals, idle gaps, and per-row
  // threshold metrics in one scan using window functions.
  const stmt = db.prepare(`
    SELECT
      session_id,
      timestamp,
      input_tokens,
      output_tokens,
      cached_tokens,
      credits,
      SUM(input_tokens + cached_tokens) OVER (PARTITION BY session_id) AS session_total_input,
      LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_timestamp
    FROM turns
    WHERE timestamp >= :since
    ORDER BY session_id ASC, timestamp ASC
  `);
  stmt.bind({ ":since": sinceMs });

  let totalOutputTokens = 0;
  let turnsWithOutput = 0;
  let maxSessionInputTokens = 0;
  let maxIdleGapMs = 0;

  const acc: AlertMetricAccumulator = {
    microTurnCount: 0,
    microTurnOutputTotal: 0,
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
    const sessionTotalInput = (row.session_total_input as number) || 0;
    const prevTimestamp = row.prev_timestamp as number | null;
    const timestamp = (row.timestamp as number) || 0;

    // Verbosity
    if (outputTokens > 0) {
      totalOutputTokens += outputTokens;
      turnsWithOutput++;
    }

    // Max session input
    if (sessionTotalInput > maxSessionInputTokens) {
      maxSessionInputTokens = sessionTotalInput;
    }

    // Max idle gap
    if (prevTimestamp != null) {
      const gap = timestamp - prevTimestamp;
      if (gap > maxIdleGapMs) {
        maxIdleGapMs = gap;
      }
    }

    // Threshold alert metrics (reuse existing accumulator logic)
    applyAlertMetricRow(
      acc,
      [row.session_id, timestamp, inputTokens, outputTokens, cachedTokens, row.credits],
      cfg
    );
  }
  stmt.free();

  if (acc.microTurnCount < cfg.microTurnMinCount) {
    acc.microTurnCount = 0;
    acc.microTurnOutputTotal = 0;
  }

  return {
    avgOutputTokensToday: turnsWithOutput > 0 ? totalOutputTokens / turnsWithOutput : 0,
    turnsToday: turnsWithOutput,
    maxSessionInputTokens,
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
    GROUP BY model_family
    ORDER BY total_write_tokens + total_read_tokens DESC
  `);
  stmt.bind({ ":since": safeSince, ":workspace": workspace ?? null });

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
