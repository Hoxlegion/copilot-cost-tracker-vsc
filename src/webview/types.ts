/**
 * Re-export all dashboard types from the shared contract.
 * Webview components import from this file so that the shared
 * types are the single source of truth across both process boundaries.
 */
export type {
  DashboardMessage,
  DashboardRawData,
  InsightMetrics,
  CacheSavingsMetrics,
  DashboardAlert,
  PlaybookRow,
  SurfaceBreakdown,
  TurnDiscoveryRow,
  ContextDistributionItem,
  ContextTimelineData,
  SessionEntry,
  SessionModelBreakdownEntry,
} from "../shared/dashboardTypes";
