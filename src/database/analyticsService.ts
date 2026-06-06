/**
 * Analytics service for deriving business insights from raw cost data.
 * Separates analytical and aggregation logic from storage persistence.
 */

import { CostDatabase, InsightMetrics, AlertMetrics, AlertThresholdConfig } from "./costDatabase";

/**
 * Analytics service provides high-level aggregations and derived metrics
 * from the cost database. Database remains responsible only for CRUD and
 * primitive queries; this service handles all business intelligence.
 */
export class AnalyticsService {
  constructor(private readonly database: CostDatabase) {}

  private getDefaultAlertThresholdConfig(): AlertThresholdConfig {
    return {
      microTurnGapMs: 120_000,
      microTurnMinCount: 5,
      microTurnMaxOutputTokens: 200,
      rawPasteMinInputTokens: 15_000,
      premiumMisallocationMinCredits: 2,
      premiumMisallocationMaxOutputTokens: 100,
      agentSprawlMinInputTokens: 80_000,
    };
  }

  /**
   * Get insight metrics: cache hit rate, I/O token ratio trend, and error count.
   * Used by the Insights dashboard tab.
   */
  getInsightMetrics(days: number = 30): InsightMetrics {
    return this.database.getInsightMetrics(days);
  }

  /**
   * Get raw metrics used by the insight engine to generate actionable alerts.
   * Covers: output verbosity, session context size, and cache decay idle gaps.
   */
  getAlertMetrics(
    sinceMs: number,
    thresholds?: Partial<AlertThresholdConfig>
  ): AlertMetrics {
    return this.database.getAlertMetrics(sinceMs, thresholds);
  }
}
