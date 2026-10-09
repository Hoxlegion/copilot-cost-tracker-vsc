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
import type { TurnSource } from "../parser/types";
import type { DashboardRawData, DashboardSourceFilter } from "../shared/dashboardTypes";

export type { DashboardRawData };

export interface DashboardSourceOptions {
  sourceFilter?: DashboardSourceFilter;
  /** Whether Copilot CLI credits count toward the budget when all sources are shown. */
  includeCliInBudget?: boolean;
}

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

  async assemble(
    billingCycleStartDay: number,
    budgetCredits: number,
    currency: string = "USD",
    exchangeRate: number = 1,
    alertWindowHours?: number,
    sessionLimit: number = 200,
    { sourceFilter = "all", includeCliInBudget = true }: DashboardSourceOptions = {},
  ): Promise<DashboardRawData> {
    const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);
    const periodEndMs = getBillingPeriodEndMs(billingCycleStartDay);
    const sinceMs30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const source: TurnSource | undefined = sourceFilter === "all" ? undefined : sourceFilter;
    // Budget figures follow the budget setting unless a single source is selected.
    const budgetSource: TurnSource | undefined = source ?? (includeCliInBudget ? undefined : "chat");

    // Fetch async data from the reader in parallel (Copilot Chat only)
    const [surfaceData, turnDiscovery] = await Promise.all([
      this.reader.getSurfaceBreakdown(sinceMs30d),
      this.reader.getTurnDiscovery(sinceMs30d),
    ]);

    // Synchronous database queries
    const insightMetrics = this.database.getInsightMetrics(30, source);
    const monthTotal = this.database.getCurrentMonthTotal(billingCycleStartDay, undefined, budgetSource);
    const dailyCostsForRange = this.database.getDailyCosts(365, undefined, source);
    const cutoff = new Date(sinceMs30d);
    const thirtyDaysAgo = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const dailyCosts = dailyCostsForRange.filter(d => d.period >= thirtyDaysAgo);
    const insightMetricsFullRange = this.database.getInsightMetrics(365, source);
    const modelBreakdown = this.database.getModelBreakdown(30, undefined, source);
    const agentBreakdown = this.database.getAgentBreakdown(30, undefined, source);
    const dailyAgentBreakdown = this.database.getDailyAgentBreakdown(365, undefined, source);
    const allSessions = this.database.getSessionSummaries(undefined, sessionLimit, source);
    const periodCredits = this.database.getCreditsSince(periodStartMs, budgetSource);
    const periodAggregate = this.database.getCostSince(periodStartMs, undefined, budgetSource);
    const cacheSavings = this.database.getCacheSavingsMetrics(
      periodStartMs,
      undefined,
      (model, write, read) => this.pricing.calculateCacheSavings(model, write, read),
      source,
    );
    const contextDistribution = this.database.getSessionContextDistribution(sinceMs30d);
    const hasCliData = this.database.getCostBySourceSince(0).some((s) => s.source === "cli");
    const cliSessionsWithoutUsage = this.database.countCliSessionsWithoutUsage(periodStartMs);

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

    const alerts = getAlerts(this.database, undefined, alertWindowHours);
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
      currency,
      exchangeRate,
      sourceFilter,
      hasCliData,
      cliSessionsWithoutUsage,
    };
  }
}
