/**
 * Dashboard data assembler — collects and fetches all data needed by dashboard tabs.
 * Separates data gathering from view-model transformation and rendering.
 */

import { CostDatabase, InsightMetrics, CacheSavingsMetrics } from "../database";
import { TracesDbReader, SurfaceBreakdown, TurnDiscoveryRow } from "../parser";
import { getBillingPeriodEndMs, getBillingPeriodStartMs } from "../billing";
import { getAlerts, buildPlaybook, DashboardAlert, PlaybookRow } from "../insights";

export interface DashboardRawData {
  insightMetrics: InsightMetrics;
  alerts: DashboardAlert[];
  playbook: PlaybookRow[];
  surfaceData: SurfaceBreakdown[];
  turnDiscovery: TurnDiscoveryRow[];
  cacheSavings: CacheSavingsMetrics;
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
    modelBreakdown: Array<{
      model: string;
      turnCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedTokens: number;
      totalCostUsd: number;
      totalCredits: number;
    }>;
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
      turnDiscovery,
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
      cacheSavings,
    ] = await Promise.all([
      Promise.resolve(this.database.getInsightMetrics(30)),
      this.reader.getSurfaceBreakdown(sinceMs30d),
      this.reader.getTurnDiscovery(sinceMs30d),
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
      Promise.resolve(this.database.getCacheSavingsMetrics(periodStartMs)),
    ]);

    const sessionModelRows = this.database.getSessionModelBreakdowns(allSessions.map((s) => s.sessionId));
    const sessionModelMap = new Map<string, typeof sessionModelRows>();
    for (const row of sessionModelRows) {
      const list = sessionModelMap.get(row.sessionId) ?? [];
      list.push(row);
      sessionModelMap.set(row.sessionId, list);
    }

    const allSessionsWithBreakdown = allSessions.map((session) => ({
      ...session,
      modelBreakdown: (sessionModelMap.get(session.sessionId) ?? []).map((row) => ({
        model: row.model,
        turnCount: row.turnCount,
        totalInputTokens: row.totalInputTokens,
        totalOutputTokens: row.totalOutputTokens,
        totalCachedTokens: row.totalCachedTokens,
        totalCostUsd: row.totalCostUsd,
        totalCredits: row.totalCredits,
      })),
    }));

    const alerts = getAlerts(this.database);
    const playbook = buildPlaybook(alerts);

    return {
      insightMetrics,
      alerts,
      playbook,
      surfaceData,
      turnDiscovery,
      cacheSavings,
      monthTotal,
      dailyCosts,
      dailyCostsForRange,
      insightMetricsFullRange,
      modelBreakdown,
      agentBreakdown,
      dailyAgentBreakdown,
      allSessions: allSessionsWithBreakdown,
      billingPeriodStartMs: periodStartMs,
      billingPeriodEndMs: periodEndMs,
      periodCredits,
      periodAggregate,
    };
  }
}
