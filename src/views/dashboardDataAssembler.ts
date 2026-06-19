/**
 * Dashboard data assembler — collects and fetches all data needed by dashboard tabs.
 * Separates data gathering from view-model transformation and rendering.
 */

import { CostReader } from "../database";
import { TracesDbReader } from "../parser";
import { PricingEngine } from "../pricing";
import { getBillingPeriodEndMs, getBillingPeriodStartMs } from "../billing";
import { getAlerts, buildPlaybook } from "../insights";
import { resolveWorkspaceName } from "./helpers/workspaceResolver";
import type { DashboardRawData } from "../shared/dashboardTypes";

export type { DashboardRawData };

/**
 * Assembles all raw data needed by the dashboard from database, pricing, and parser.
 * Decouples data fetching from presentation concerns.
 */
export class DashboardDataAssembler {
  constructor(
    private readonly database: CostReader,
    private readonly reader: TracesDbReader,
    private readonly pricing: PricingEngine,
  ) {}

  async assemble(billingCycleStartDay: number, budgetCredits: number): Promise<DashboardRawData> {
    const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);
    const periodEndMs = getBillingPeriodEndMs(billingCycleStartDay);
    const sinceMs30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Fetch async data from the reader in parallel
    const [surfaceData, turnDiscovery] = await Promise.all([
      this.reader.getSurfaceBreakdown(sinceMs30d),
      this.reader.getTurnDiscovery(sinceMs30d),
    ]);

    // Synchronous database queries
    const insightMetrics = this.database.getInsightMetrics(30);
    const monthTotal = this.database.getCurrentMonthTotal();
    const dailyCostsForRange = this.database.getDailyCosts(365);
    const thirtyDaysAgo = new Date(sinceMs30d).toISOString().slice(0, 10);
    const dailyCosts = dailyCostsForRange.filter(d => d.period >= thirtyDaysAgo);
    const insightMetricsFullRange = this.database.getInsightMetrics(365);
    const modelBreakdown = this.database.getModelBreakdown(30);
    const agentBreakdown = this.database.getAgentBreakdown(30);
    const dailyAgentBreakdown = this.database.getDailyAgentBreakdown(365);
    const allSessions = this.database.getSessionSummaries(undefined, 1000);
    const periodCredits = this.database.getCreditsSince(periodStartMs);
    const periodAggregate = this.database.getCostSince(periodStartMs);
    const cacheSavings = this.database.getCacheSavingsMetrics(
      periodStartMs,
      undefined,
      (model, write, read) => this.pricing.calculateCacheSavingsCost(model, write, read),
    );
    const contextDistribution = this.database.getSessionContextDistribution(sinceMs30d);

    const sessionModelRows = this.database.getSessionModelBreakdowns(allSessions.map((s) => s.sessionId));
    const sessionModelMap = new Map<string, typeof sessionModelRows>();
    for (const row of sessionModelRows) {
      const list = sessionModelMap.get(row.sessionId) ?? [];
      list.push(row);
      sessionModelMap.set(row.sessionId, list);
    }

    const allSessionsWithBreakdown = allSessions.map((session) => ({
      ...session,
      workspace: resolveWorkspaceName(session.workspace),
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

    const topHeaviestSessions = contextDistribution.filter((s) => s.turnCount > 3).slice(0, 5);
    const contextTimelines = topHeaviestSessions.map((s) => ({
      sessionId: s.sessionId,
      workspace: resolveWorkspaceName(s.workspace),
      startMs: s.startMs,
      turns: this.database.getSessionContextTimeline(s.sessionId),
    }));

    const lastUpdatedMs = allSessions.length > 0
      ? Math.max(...allSessions.map(s => s.lastTimestamp))
      : Date.now();

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
      budgetCredits,
      lastUpdatedMs,
      contextDistribution,
      contextTimelines,
    };
  }
}
