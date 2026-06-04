/**
 * Dashboard data assembler — collects and fetches all data needed by dashboard tabs.
 * Separates data gathering from view-model transformation and rendering.
 */

import { CostDatabase, InsightMetrics } from "../database";
import { TracesDbReader, SurfaceBreakdown } from "../parser";
import { getBillingPeriodEndMs, getBillingPeriodStartMs } from "../billing";
import { getAlerts, buildPlaybook, DashboardAlert, PlaybookRow } from "../insights";

export interface DashboardRawData {
  insightMetrics: InsightMetrics;
  alerts: DashboardAlert[];
  playbook: PlaybookRow[];
  surfaceData: SurfaceBreakdown[];
  monthTotal: { costUsd: number; credits: number; turns: number };
  dailyCosts: Array<{ period: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  dailyCostsForRange: Array<{ period: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  insightMetricsFullRange: InsightMetrics;
  modelBreakdown: Array<{ model: string; totalCostUsd: number; totalCredits: number; turnCount: number; percentage: number }>;
  agentBreakdown: Array<{ agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number; percentage: number }>;
  dailyAgentBreakdown: Array<{ period: string; agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  allSessions: Array<{
    sessionId: string;
    workspace: string;
    startTimestamp: number;
    lastTimestamp: number;
    turnCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    totalCostUsd: number;
    totalCredits: number;
    primaryModel: string;
    avgDurationMs: number;
  }>;
  billingPeriodStartMs: number;
  billingPeriodEndMs: number;
  periodCredits: number;
  periodAggregate: { costUsd: number; credits: number; turns: number };
}

/**
 * Assembles all raw data needed by the dashboard from database, pricing, and parser.
 * Decouples data fetching from presentation concerns.
 */
export class DashboardDataAssembler {
  constructor(
    private readonly database: CostDatabase,
    private readonly reader: TracesDbReader
  ) {}

  async assemble(billingCycleStartDay: number): Promise<DashboardRawData> {
    const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);
    const periodEndMs = getBillingPeriodEndMs(billingCycleStartDay);
    const sinceMs30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Fetch all data in parallel where possible
    const [
      insightMetrics,
      surfaceData,
      monthTotal,
      dailyCosts,
      dailyCostsForRange,
      insightMetricsFullRange,
      modelBreakdown,
      agentBreakdown,
      dailyAgentBreakdown,
      allSessions,
      periodCredits,
      periodAggregate,
    ] = await Promise.all([
      Promise.resolve(this.database.getInsightMetrics(30)),
      this.reader.getSurfaceBreakdown(sinceMs30d),
      Promise.resolve(this.database.getCurrentMonthTotal()),
      Promise.resolve(this.database.getDailyCosts(30)),
      Promise.resolve(this.database.getDailyCosts(365)),
      Promise.resolve(this.database.getInsightMetrics(365)),
      Promise.resolve(this.database.getModelBreakdown(30)),
      Promise.resolve(this.database.getAgentBreakdown(30)),
      Promise.resolve(this.database.getDailyAgentBreakdown(365)),
      Promise.resolve(this.database.getSessionSummaries(undefined, 1000)),
      Promise.resolve(this.database.getCreditsSince(periodStartMs)),
      Promise.resolve(this.database.getCostSince(periodStartMs)),
    ]);

    const alerts = getAlerts(this.database);
    const playbook = buildPlaybook(alerts);

    return {
      insightMetrics,
      alerts,
      playbook,
      surfaceData,
      monthTotal,
      dailyCosts,
      dailyCostsForRange,
      insightMetricsFullRange,
      modelBreakdown,
      agentBreakdown,
      dailyAgentBreakdown,
      allSessions,
      billingPeriodStartMs: periodStartMs,
      billingPeriodEndMs: periodEndMs,
      periodCredits,
      periodAggregate,
    };
  }
}
