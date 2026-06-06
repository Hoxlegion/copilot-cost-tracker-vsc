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

function getVerbosityMetrics(db: Database, sinceMs: number): { avgOutputTokensToday: number; turnsToday: number } {
  const verbosityResult = db.exec(`
    SELECT AVG(CAST(output_tokens AS REAL)), COUNT(*)
    FROM turns WHERE timestamp >= ${sinceMs} AND output_tokens > 0
  `);

  if (verbosityResult.length === 0 || verbosityResult[0].values.length === 0) {
    return { avgOutputTokensToday: 0, turnsToday: 0 };
  }

  const row = verbosityResult[0].values[0];
  return {
    avgOutputTokensToday: (row[0] as number) || 0,
    turnsToday: (row[1] as number) || 0,
  };
}

function getMaxSessionInputTokensSince(db: Database, sinceMs: number): number {
  const bloatResult = db.exec(`
    SELECT MAX(session_total) FROM (
      SELECT session_id, SUM(input_tokens + cached_tokens) AS session_total
      FROM turns WHERE timestamp >= ${sinceMs}
      GROUP BY session_id
    )
  `);

  if (bloatResult.length === 0 || bloatResult[0].values.length === 0) {
    return 0;
  }

  return (bloatResult[0].values[0][0] as number) || 0;
}

function getMaxIdleGapMsSince(db: Database, sinceMs: number): number {
  const gapResult = db.exec(`
    SELECT MAX(gap_ms) FROM (
      SELECT
        t1.session_id,
        (
          SELECT MIN(t2.timestamp) FROM turns t2
          WHERE t2.session_id = t1.session_id AND t2.timestamp > t1.timestamp
        ) - t1.timestamp AS gap_ms
      FROM turns t1
      WHERE t1.timestamp >= ${sinceMs}
    )
    WHERE gap_ms IS NOT NULL
  `);

  if (gapResult.length === 0 || gapResult[0].values.length === 0) {
    return 0;
  }

  return (gapResult[0].values[0][0] as number) || 0;
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

  const netInput = Math.max(0, inputTokens - cachedTokens);
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

function getThresholdAlertMetrics(
  db: Database,
  sinceMs: number,
  cfg: AlertThresholdConfig
): {
  microTurnCount: number;
  microTurnAvgOutput: number;
  rawPasteMaxNetInput: number;
  premiumMisallocationCount: number;
  premiumMisallocationAvgCredits: number;
  massiveContextMaxInput: number;
} {
  const rowsResult = db.exec(`
    SELECT session_id, timestamp, input_tokens, output_tokens, cached_tokens, credits
    FROM turns WHERE timestamp >= ${sinceMs}
    ORDER BY session_id ASC, timestamp ASC
  `);

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

  if (rowsResult.length > 0) {
    for (const row of rowsResult[0].values) {
      applyAlertMetricRow(acc, row, cfg);
    }
  }

  if (acc.microTurnCount < cfg.microTurnMinCount) {
    acc.microTurnCount = 0;
    acc.microTurnOutputTotal = 0;
  }

  const microTurnAvgOutput = acc.microTurnCount > 0
    ? Math.round(acc.microTurnOutputTotal / acc.microTurnCount)
    : 0;

  const premiumMisallocationAvgCredits = acc.premiumMisallocationCount > 0
    ? acc.premiumMisallocationCreditsTotal / acc.premiumMisallocationCount
    : 0;

  return {
    microTurnCount: acc.microTurnCount,
    microTurnAvgOutput,
    rawPasteMaxNetInput: acc.rawPasteMaxNetInput,
    premiumMisallocationCount: acc.premiumMisallocationCount,
    premiumMisallocationAvgCredits,
    massiveContextMaxInput: acc.massiveContextMaxInput,
  };
}

export function getInsightMetrics(db: Database, days: number = 30): InsightMetrics {
  const safeDays = clampIntForMetrics(days, 1, 3650);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const totalsResult = db.exec(`
    SELECT
      COALESCE(SUM(input_tokens), 0),
      COALESCE(SUM(output_tokens), 0),
      COALESCE(SUM(cached_tokens), 0),
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0),
      COUNT(*)
    FROM turns WHERE timestamp >= ${since}
  `);

  let totalInputTokens = 0, totalOutputTokens = 0, totalCachedTokens = 0, errorTurns = 0, totalTurns = 0;
  if (totalsResult.length > 0 && totalsResult[0].values.length > 0) {
    const row = totalsResult[0].values[0];
    totalInputTokens = (row[0] as number) || 0;
    totalOutputTokens = (row[1] as number) || 0;
    totalCachedTokens = (row[2] as number) || 0;
    errorTurns = (row[3] as number) || 0;
    totalTurns = (row[4] as number) || 0;
  }

  const totalBillableInput = totalInputTokens + totalCachedTokens;
  const cacheHitPct = totalBillableInput > 0
    ? Math.round((totalCachedTokens / totalBillableInput) * 1000) / 10
    : 0;

  const dailyResult = db.exec(`
    SELECT
      date(timestamp / 1000, 'unixepoch') as period,
      SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens)
    FROM turns WHERE timestamp >= ${since}
    GROUP BY period ORDER BY period ASC
  `);

  const ioRatioDays: InsightMetrics["ioRatioDays"] = [];
  if (dailyResult.length > 0) {
    for (const row of dailyResult[0].values) {
      ioRatioDays.push({
        period: row[0] as string,
        inputTokens: (row[1] as number) || 0,
        outputTokens: (row[2] as number) || 0,
        cachedTokens: (row[3] as number) || 0,
      });
    }
  }

  return { totalInputTokens, totalOutputTokens, totalCachedTokens, errorTurns, totalTurns, cacheHitPct, ioRatioDays };
}

export function getAlertMetrics(
  db: Database,
  sinceMs: number,
  thresholds?: Partial<AlertThresholdConfig>
): AlertMetrics {
  const cfg = getAlertThresholdConfig(thresholds);
  const { avgOutputTokensToday, turnsToday } = getVerbosityMetrics(db, sinceMs);
  const maxSessionInputTokens = getMaxSessionInputTokensSince(db, sinceMs);
  const maxIdleGapMs = getMaxIdleGapMsSince(db, sinceMs);
  const {
    microTurnCount,
    microTurnAvgOutput,
    rawPasteMaxNetInput,
    premiumMisallocationCount,
    premiumMisallocationAvgCredits,
    massiveContextMaxInput,
  } = getThresholdAlertMetrics(db, sinceMs, cfg);

  return {
    avgOutputTokensToday,
    turnsToday,
    maxSessionInputTokens,
    maxIdleGapMs,
    microTurnCount,
    microTurnAvgOutput,
    rawPasteMaxNetInput,
    premiumMisallocationCount,
    premiumMisallocationAvgCredits,
    massiveContextMaxInput,
  };
}

export function getCacheSavingsMetrics(db: Database, sinceMs: number, workspace?: string): CacheSavingsMetrics {
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

  while (stmt.step()) {
    const row = stmt.getAsObject();
    const writeTokens = (row.total_write_tokens as number) || 0;
    const readTokens = (row.total_read_tokens as number) || 0;

    totalWriteTokens += writeTokens;
    totalReadTokens += readTokens;

    byModel.push({
      modelFamily: row.model_family as string,
      cacheWriteTokens: writeTokens,
      cacheReadTokens: readTokens,
      savingsCostUsd: 0,
      savingsCredits: 0,
      percentage: 0,
    });
  }
  stmt.free();

  return {
    totalCacheWriteTokens: totalWriteTokens,
    totalCacheReadTokens: totalReadTokens,
    totalSavingsCostUsd: 0,
    totalSavingsCredits: 0,
    byModel,
  };
}

function clampIntForMetrics(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
