import * as vscode from "vscode";
import { CostDatabase, SessionContextInfo } from "../database";
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
  private readonly database: CostDatabase;
  private readonly logger: Logger;
  private currentWeight: ContextWeight | null = null;
  private trackedSessionId: string | null = null;
  private readonly firedThresholds: Set<number> = new Set();
  private notificationsEnabled: boolean = true;

  constructor(database: CostDatabase, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.notificationsEnabled = enabled;
  }

  update(): ContextWeight | null {
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const info = this.database.getMostRecentSessionContext(sinceMs);

    if (!info) {
      this.currentWeight = null;
      return null;
    }

    const tier = classifyTier(info.currentContextWeight);
    this.currentWeight = {
      tokens: info.currentContextWeight,
      tier,
      label: TIER_LABELS[tier],
      humanLabel: tokensToPages(info.currentContextWeight),
      sessionId: info.sessionId,
      turnCount: info.turnCount,
      lastActivityMs: info.lastActivityMs,
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
