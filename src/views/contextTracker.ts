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

interface ContextNotificationLevel {
  minTokens: number;
  warning: boolean;
  message: (pages: string, kTokens: string) => string;
}

// Ascending. Each session gets at most one notification per level, and only for the highest level reached.
const NOTIFICATION_LEVELS: readonly ContextNotificationLevel[] = [
  {
    minTokens: 20_000,
    warning: false,
    message: (pages, kTokens) => `Copilot Cost Tracker: Your active chat session is carrying ${pages} of context (~${kTokens}K tokens). Each new message re-sends all of it. Consider starting a fresh chat for unrelated work.`,
  },
  {
    minTokens: 40_000,
    warning: false,
    message: (pages, kTokens) => `Copilot Cost Tracker: Your chat session context has reached ${pages} (~${kTokens}K tokens). Each new message re-sends all of it, so costs climb quickly. Consider starting a fresh chat or running /compact.`,
  },
  {
    minTokens: 80_000,
    warning: true,
    message: (pages, kTokens) => `Copilot Cost Tracker: Your chat session context is extremely heavy — ${pages} (~${kTokens}K tokens). Response quality may degrade and every new message re-sends all of it. Start a fresh chat to improve speed and cut costs.`,
  },
];

/** Shared state key, so window reloads and other windows don't repeat a session's notifications. */
const NOTIFIED_LEVELS_KEY = "contextTracker.notifiedLevels";
const NOTIFIED_LEVELS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type NotifiedLevels = Record<string, { level: number; at: number }>;

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
  private readonly state: vscode.Memento | undefined;
  private currentWeight: ContextWeight | null = null;
  private readonly notifiedLevels = new Map<string, number>();
  private notificationsEnabled: boolean = true;
  /** When set, context/cost is scoped to this repo so multiple windows stay independent. */
  private workspaceRepo: string | null = null;

  constructor(database: CostReader, logger: Logger, workspaceRepo: string | null = null, state?: vscode.Memento) {
    this.database = database;
    this.logger = logger;
    this.workspaceRepo = workspaceRepo;
    this.state = state;
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

    // A stale session is not being worked on, so there is nothing to act on yet.
    if (!stale) {
      this.checkNotificationThresholds(info);
    }

    return this.currentWeight;
  }

  getContextWeight(): ContextWeight | null {
    return this.currentWeight;
  }

  private checkNotificationThresholds(info: SessionContextInfo): void {
    if (!this.notificationsEnabled) return;

    const tokens = info.currentContextWeight;
    const level = NOTIFICATION_LEVELS.reduce((highest, l, index) => (tokens >= l.minTokens ? index : highest), -1);
    if (level < 0 || level <= this.getNotifiedLevel(info.sessionId)) return;

    this.recordNotifiedLevel(info.sessionId, level);
    const { warning, message: buildMessage } = NOTIFICATION_LEVELS[level];
    const message = buildMessage(tokensToPages(tokens), (tokens / 1000).toFixed(0));
    if (warning) {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
    this.logger.warn(message);
  }

  private getNotifiedLevel(sessionId: string): number {
    const stored = this.state?.get<NotifiedLevels>(NOTIFIED_LEVELS_KEY)?.[sessionId]?.level;
    return Math.max(typeof stored === "number" ? stored : -1, this.notifiedLevels.get(sessionId) ?? -1);
  }

  private recordNotifiedLevel(sessionId: string, level: number): void {
    this.notifiedLevels.set(sessionId, level);
    if (!this.state) return;

    const now = Date.now();
    const kept: NotifiedLevels = {};
    for (const [id, entry] of Object.entries(this.state.get<NotifiedLevels>(NOTIFIED_LEVELS_KEY) ?? {})) {
      if (now - entry.at < NOTIFIED_LEVELS_RETENTION_MS) kept[id] = entry;
    }
    kept[sessionId] = { level, at: now };
    this.state.update(NOTIFIED_LEVELS_KEY, kept).then(undefined, (err) => this.logger.debug("Failed to store context notification state", err));
  }

  dispose(): void {
    // no-op: no resources to release
  }
}
