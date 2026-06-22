import * as vscode from "vscode";
import { CostReader, SessionContextInfo } from "../database";
import { Logger } from "../logger";

export type ContextTier = "light" | "moderate" | "heavy" | "critical";

export interface ContextWeight {
  tokens: number;
  tier: ContextTier;
  label: string;
  humanLabel: string;
  sessionId: string | null;
  turnCount: number;
  lastActivityMs: number;
  /** Total cost of the active chat session so far (USD). */
  costUsd: number;
  /** Total credits of the active chat session so far. */
  credits: number;
  /** True when the active session has had no activity for a while (still shown, just stale). */
  stale: boolean;
}

const TIER_THRESHOLDS = {
  light: 5_000,
  moderate: 20_000,
  heavy: 40_000,
};

const NOTIFICATION_THRESHOLDS = [20_000, 40_000, 80_000];

const TIER_LABELS: Record<ContextTier, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  critical: "Critical",
};

function classifyTier(tokens: number): ContextTier {
  if (tokens <= TIER_THRESHOLDS.light) return "light";
  if (tokens <= TIER_THRESHOLDS.moderate) return "moderate";
  if (tokens <= TIER_THRESHOLDS.heavy) return "heavy";
  return "critical";
}

function tokensToPages(tokens: number): string {
  const pages = Math.round(tokens / 2500);
  if (pages <= 0) return "< 1 page";
  if (pages === 1) return "~1 page";
  return `~${pages} pages`;
}

export class ContextTracker implements vscode.Disposable {
  private readonly database: CostReader;
  private readonly logger: Logger;
  private currentWeight: ContextWeight | null = null;
  private trackedSessionId: string | null = null;
  private readonly firedThresholds: Set<number> = new Set();
  private notificationsEnabled: boolean = true;
  /** When set, context/cost is scoped to this repo so multiple windows stay independent. */
  private workspaceRepo: string | null = null;

  constructor(database: CostReader, logger: Logger, workspaceRepo: string | null = null) {
    this.database = database;
    this.logger = logger;
    this.workspaceRepo = workspaceRepo;
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.notificationsEnabled = enabled;
  }

  /** Update which repo the active-session lookup is scoped to (current window's repo). */
  setWorkspaceRepo(repo: string | null): void {
    this.workspaceRepo = repo;
  }

  // Mark context as "stale" (rather than hiding it) after this much inactivity, so
  // the active conversation's weight/cost persists when you step away or reopen it.
  private static readonly STALENESS_THRESHOLD_MS = 30 * 60 * 1000;

  update(): ContextWeight | null {
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const info = this.database.getMostRecentSessionContext(sinceMs, this.workspaceRepo ?? undefined);

    if (!info) {
      this.currentWeight = null;
      return null;
    }

    // Keep showing the most recent session for this repo even when idle; only
    // flag it as stale so the UI can de-emphasize it. This means re-opening a
    // chat shows its real accumulated context/cost instead of resetting.
    const age = Date.now() - info.lastActivityMs;
    const stale = age > ContextTracker.STALENESS_THRESHOLD_MS;

    const tier = classifyTier(info.currentContextWeight);
    this.currentWeight = {
      tokens: info.currentContextWeight,
      tier,
      label: TIER_LABELS[tier],
      humanLabel: tokensToPages(info.currentContextWeight),
      sessionId: info.sessionId,
      turnCount: info.turnCount,
      lastActivityMs: info.lastActivityMs,
      costUsd: info.costUsd,
      credits: info.credits,
      stale,
    };

    if (info.sessionId !== this.trackedSessionId) {
      this.trackedSessionId = info.sessionId;
      this.firedThresholds.clear();
    }

    this.checkNotificationThresholds(info);

    return this.currentWeight;
  }

  getContextWeight(): ContextWeight | null {
    return this.currentWeight;
  }

  private checkNotificationThresholds(info: SessionContextInfo): void {
    if (!this.notificationsEnabled) return;

    for (const threshold of NOTIFICATION_THRESHOLDS) {
      if (info.currentContextWeight >= threshold && !this.firedThresholds.has(threshold)) {
        this.firedThresholds.add(threshold);
        const pages = tokensToPages(info.currentContextWeight);

        let message: string;
        if (threshold === 50_000) {
          message = `Copilot Cost Tracker: Your active chat session is carrying ${pages} of context (~${(info.currentContextWeight / 1000).toFixed(0)}K tokens). Each new message resends all of it. Consider starting a fresh chat.`;
        } else if (threshold === 100_000) {
          message = `Copilot Cost Tracker: Your chat session context has reached ${pages} (~${(info.currentContextWeight / 1000).toFixed(0)}K tokens). Response quality may degrade and costs increase. Start a new chat for best results.`;
        } else {
          message = `Copilot Cost Tracker: Your chat session context is ${pages} (~${(info.currentContextWeight / 1000).toFixed(0)}K tokens). This is extremely heavy. Starting a fresh chat will significantly improve speed and reduce costs.`;
        }

        if (threshold >= 200_000) {
          vscode.window.showErrorMessage(message);
        } else {
          vscode.window.showWarningMessage(message);
        }
        this.logger.warn(message);
      }
    }
  }

  dispose(): void {
    // no-op: no resources to release
  }
}
