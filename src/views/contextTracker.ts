import * as vscode from "vscode";
import { CostReader, SessionContextInfo } from "../database";
import { Logger } from "../logger";
import { CONTEXT_TIER_LABELS, CONTEXT_TIER_THRESHOLDS, classifyContextTier, type ContextTier } from "../shared/contextTiers";

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

interface ContextNotificationLevel {
  aboveTokens: number;
  warning: boolean;
  message: (pages: string, kTokens: string) => string;
}

// Ascending. Each session gets at most one notification per level, and only for the highest level reached.
const NOTIFICATION_LEVELS: readonly ContextNotificationLevel[] = [
  {
    aboveTokens: CONTEXT_TIER_THRESHOLDS.heavy,
    warning: false,
    message: (pages, kTokens) => `Copilot Cost Tracker: Your active chat now re-sends ${pages} of context (~${kTokens}K tokens) with every request, so each message costs noticeably more than in a fresh chat. Consider a fresh chat for unrelated work, or run /compact.`,
  },
  {
    aboveTokens: CONTEXT_TIER_THRESHOLDS.critical,
    warning: true,
    message: (pages, kTokens) => `Copilot Cost Tracker: Your active chat's context is very large: ${pages} (~${kTokens}K tokens) re-sent with every request. Each message is expensive and response quality may degrade. Start a fresh chat or run /compact.`,
  },
];

/** Shared state key, so window reloads and other windows don't repeat a session's notifications. */
const NOTIFIED_THRESHOLDS_KEY = "contextTracker.notifiedThresholds";
const NOTIFIED_THRESHOLDS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Per session: the highest level threshold (in tokens) that was already notified. */
type NotifiedThresholds = Record<string, { aboveTokens: number; at: number }>;

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
  private readonly notifiedThresholds = new Map<string, number>();
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

    const tier = classifyContextTier(info.currentContextWeight);
    this.currentWeight = {
      tokens: info.currentContextWeight,
      tier,
      label: CONTEXT_TIER_LABELS[tier],
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
    const level = NOTIFICATION_LEVELS.filter((l) => tokens > l.aboveTokens).at(-1);
    if (!level || level.aboveTokens <= this.getNotifiedThreshold(info.sessionId)) return;

    this.recordNotifiedThreshold(info.sessionId, level.aboveTokens);
    const { warning, message: buildMessage } = level;
    const message = buildMessage(tokensToPages(tokens), (tokens / 1000).toFixed(0));
    if (warning) {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
    this.logger.warn(message);
  }

  private getNotifiedThreshold(sessionId: string): number {
    const stored = this.state?.get<NotifiedThresholds>(NOTIFIED_THRESHOLDS_KEY)?.[sessionId]?.aboveTokens;
    return Math.max(typeof stored === "number" ? stored : -1, this.notifiedThresholds.get(sessionId) ?? -1);
  }

  private recordNotifiedThreshold(sessionId: string, aboveTokens: number): void {
    this.notifiedThresholds.set(sessionId, aboveTokens);
    if (!this.state) return;

    const now = Date.now();
    const kept: NotifiedThresholds = {};
    for (const [id, entry] of Object.entries(this.state.get<NotifiedThresholds>(NOTIFIED_THRESHOLDS_KEY) ?? {})) {
      if (now - entry.at < NOTIFIED_THRESHOLDS_RETENTION_MS) kept[id] = entry;
    }
    kept[sessionId] = { aboveTokens, at: now };
    this.state.update(NOTIFIED_THRESHOLDS_KEY, kept).then(undefined, (err) => this.logger.debug("Failed to store context notification state", err));
  }

  dispose(): void {
    // no-op: no resources to release
  }
}
