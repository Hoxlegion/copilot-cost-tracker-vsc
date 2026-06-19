import { CostReader, AlertMetrics } from "../database";

export interface DashboardAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  tip: string;
  metric: { label: string; value: string };
}

export interface PlaybookRow {
  strategy: string;
  statusEmoji: string;
  statusLabel: string;
  metricDesc: string;
  impact: string;
}

export interface AlertThresholds {
  microTurnGapMs: number;
  microTurnMinCount: number;
  microTurnMaxOutputTokens: number;
  rawPasteMinInputTokens: number;
  premiumMisallocationMinCredits: number;
  premiumMisallocationMaxOutputTokens: number;
  agentSprawlMinInputTokens: number;
}

// Thresholds — named constants so they document intent
const HIGH_VERBOSITY_AVG_OUTPUT_TOKENS = 600; // turns averaging >600 output tokens are paying for narration
const CONTEXT_BLOAT_SESSION_INPUT_TOKENS = 40_000; // session accumulating >40K input tokens has dead weight
const CACHE_DECAY_IDLE_GAP_MS = 5 * 60 * 1000; // >5 min idle likely busts the Copilot cache TTL

// Format token counts as "1.2M" above 1M, "49.2K" above 1K, or plain number below.
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) { return `${(tokens / 1_000_000).toFixed(1)}M tokens`; }
  if (tokens >= 1_000)     { return `${(tokens / 1_000).toFixed(1)}K tokens`; }
  return `${tokens} tokens`;
}

function checkHighVerbosity(metrics: AlertMetrics): DashboardAlert | null {
  if (metrics.turnsToday < 5) {
    return null; // not enough data to fire the alert
  }
  const avg = metrics.avgOutputTokensToday;
  if (avg <= HIGH_VERBOSITY_AVG_OUTPUT_TOKENS) {
    return null;
  }
  return {
    id: "high_verbosity",
    severity: "warning",
    title: "High Output Verbosity",
    message: `Your AI is averaging ${Math.round(avg).toLocaleString()} output tokens per turn today. A large share of that is conversational framing rather than code.`,
    tip: 'Try appending "Respond in Caveman Mode" or "Skip explanations, code only" to your prompts to cut output tokens by up to 65% without losing technical accuracy.',
    metric: { label: "Avg output / turn (today)", value: `${Math.round(avg).toLocaleString()} tokens` },
  };
}

function checkContextBloat(metrics: AlertMetrics): DashboardAlert | null {
  const max = metrics.maxSessionInputTokens;
  if (max <= CONTEXT_BLOAT_SESSION_INPUT_TOKENS) {
    return null;
  }
  return {
    id: "context_bloat",
    severity: "warning",
    title: "Stale Context Accumulation",
    message: `A session today has accumulated ${formatTokens(max)} input tokens. Each subsequent turn pays to re-send this growing context window.`,
    tip: "Run /compact or start a fresh chat window to clear dead context. This prevents exponential input-token scaling over long sessions.",
    metric: { label: "Peak session input (today)", value: `${formatTokens(max)}` },
  };
}

function checkCacheDecay(metrics: AlertMetrics): DashboardAlert | null {
  const gapMs = metrics.maxIdleGapMs;
  if (gapMs <= CACHE_DECAY_IDLE_GAP_MS) {
    return null;
  }
  const gapMinutes = Math.round(gapMs / 60_000);
  return {
    id: "cache_decay",
    severity: "info",
    title: "Cache Decay Detected",
    message: `A ${gapMinutes}-minute idle gap was detected in a session today. Gaps over 5 minutes likely expire the prompt cache, turning a cheap cache-read into a full-price cache-write.`,
    tip: "If you've stepped away for more than 5 minutes, start a fresh chat session instead of continuing the old one. You'll avoid re-paying to warm up a stale context.",
    metric: { label: "Longest idle gap (today)", value: `${gapMinutes} min` },
  };
}

function checkMicroTurnTrap(metrics: AlertMetrics): DashboardAlert | null {
  if (metrics.microTurnCount === 0) {
    return null;
  }
  return {
    id: "micro_turn_trap",
    severity: "warning",
    title: "Micro-Turn Bloat Detected",
    message: `A session today had ${metrics.microTurnCount} rapid-fire turns (avg ${metrics.microTurnAvgOutput} output tokens each). Every turn resends the entire conversation history — back-and-forth messaging compounds costs exponentially.`,
    tip: "Batch your requests into a single prompt. Instead of \"Fix the typo\", then \"Add a docstring\", say \"Fix the typo and add a docstring\" in one message.",
    metric: { label: "Rapid turns in session (today)", value: `${metrics.microTurnCount} turns` },
  };
}

function checkRawPaste(metrics: AlertMetrics): DashboardAlert | null {
  if (metrics.rawPasteMaxNetInput === 0) {
    return null;
  }
  return {
    id: "raw_paste",
    severity: "warning",
    title: "Large Uncached Paste Detected",
    message: `A single turn today sent ${formatTokens(metrics.rawPasteMaxNetInput)} of net (uncached) input — likely a raw file or log paste. This bypasses context caching and is billed at full price.`,
    tip: "Open the file in your editor and reference it with #file instead of pasting raw text. This allows Copilot to chunk and cache the context efficiently. Use .copilotignore to exclude large build logs.",
    metric: { label: "Peak uncached input (today)", value: formatTokens(metrics.rawPasteMaxNetInput) },
  };
}

function checkPremiumMisallocation(metrics: AlertMetrics): DashboardAlert | null {
  if (metrics.premiumMisallocationCount === 0) {
    return null;
  }
  const avgCr = metrics.premiumMisallocationAvgCredits.toFixed(1);
  return {
    id: "premium_misallocation",
    severity: "info",
    title: "Premium Model on Routine Tasks",
    message: `${metrics.premiumMisallocationCount} turn${metrics.premiumMisallocationCount > 1 ? "s" : ""} today consumed an average of ${avgCr} credits but produced very few output tokens — typical of using a heavy model for trivial edits like typo fixes or single-line changes.`,
    tip: "Use the model picker to switch to a lighter model for routine cleanup or formatting passes. Reserve premium models for complex refactoring, architecture questions, or multi-file rewrites.",
    metric: { label: "High-cost trivial turns (today)", value: `${metrics.premiumMisallocationCount}` },
  };
}

function checkMassiveContextTurn(metrics: AlertMetrics): DashboardAlert | null {
  if (metrics.massiveContextMaxInput === 0) {
    return null;
  }
  return {
    id: "massive_context_turn",
    severity: "critical",
    title: "Massive Context Turn Detected",
    message: `A single turn today sent ${formatTokens(metrics.massiveContextMaxInput)} total input tokens. This typically happens when an agent scans a large portion of your workspace or when extensive file context is attached.`,
    tip: "Constrain your agent's scope with explicit boundaries in your prompt: \"Only look at the currently open file\" or \"Limit your search to the /src folder\". This prevents it from reading irrelevant code across the entire repository.",
    metric: { label: "Peak total input (today)", value: formatTokens(metrics.massiveContextMaxInput) },
  };
}

export function getAlerts(database: CostReader, thresholds?: AlertThresholds): DashboardAlert[] {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000; // last 24 hours
  const metrics = database.getAlertMetrics(sinceMs, thresholds ? {
    microTurnGapMs: thresholds.microTurnGapMs,
    microTurnMinCount: thresholds.microTurnMinCount,
    microTurnMaxOutputTokens: thresholds.microTurnMaxOutputTokens,
    rawPasteMinInputTokens: thresholds.rawPasteMinInputTokens,
    premiumMisallocationMinCredits: thresholds.premiumMisallocationMinCredits,
    premiumMisallocationMaxOutputTokens: thresholds.premiumMisallocationMaxOutputTokens,
    agentSprawlMinInputTokens: thresholds.agentSprawlMinInputTokens,
  } : undefined);

  const alerts: DashboardAlert[] = [];
  const verbosity = checkHighVerbosity(metrics);
  const bloat = checkContextBloat(metrics);
  const decay = checkCacheDecay(metrics);
  const microTurn = checkMicroTurnTrap(metrics);
  const rawPaste = checkRawPaste(metrics);
  const premiumMisalloc = checkPremiumMisallocation(metrics);
  const massiveContext = checkMassiveContextTurn(metrics);

  if (verbosity) { alerts.push(verbosity); }
  if (bloat) { alerts.push(bloat); }
  if (decay) { alerts.push(decay); }
  if (microTurn) { alerts.push(microTurn); }
  if (rawPaste) { alerts.push(rawPaste); }
  if (premiumMisalloc) { alerts.push(premiumMisalloc); }
  if (massiveContext) { alerts.push(massiveContext); }

  return alerts;
}

export function buildPlaybook(alerts: DashboardAlert[]): PlaybookRow[] {
  const alertIds = new Set(alerts.map(a => a.id));

  function status(id: string, greenLabel: string, warnLabel: string): { emoji: string; label: string } {
    if (!alertIds.has(id)) { return { emoji: "🟢", label: greenLabel }; }
    const sev = alerts.find(a => a.id === id)?.severity ?? "warning";
    return sev === "info"
      ? { emoji: "🟡", label: warnLabel }
      : { emoji: "🔴", label: warnLabel };
  }

  const verbosityAlert = alerts.find(a => a.id === "high_verbosity");
  const bloatAlert = alerts.find(a => a.id === "context_bloat");
  const decayAlert = alerts.find(a => a.id === "cache_decay");
  const microTurnAlert = alerts.find(a => a.id === "micro_turn_trap");
  const rawPasteAlert = alerts.find(a => a.id === "raw_paste");
  const premiumAlert = alerts.find(a => a.id === "premium_misallocation");
  const massiveAlert = alerts.find(a => a.id === "massive_context_turn");

  const verbosityStatus = status("high_verbosity", "Concise", "Verbose");
  const bloatStatus = status("context_bloat", "Clean", "Bloated");
  const decayStatus = status("cache_decay", "Optimal", "Leaking");
  const microTurnStatus = status("micro_turn_trap", "Batching well", "Ping-pong detected");
  const rawPasteStatus = status("raw_paste", "No spikes", "Paste spike");
  const premiumStatus = status("premium_misallocation", "Well routed", "Over-served");
  const massiveStatus = status("massive_context_turn", "Scoped", "Sprawling");

  return [
    {
      strategy: "Output Brevity",
      statusEmoji: verbosityStatus.emoji,
      statusLabel: verbosityStatus.label,
      metricDesc: verbosityAlert
        ? `Avg ${verbosityAlert.metric.value} output/turn`
        : "Avg output tokens within normal range",
      impact: "Up to 65% reduction in output costs",
    },
    {
      strategy: "Context Hygiene",
      statusEmoji: bloatStatus.emoji,
      statusLabel: bloatStatus.label,
      metricDesc: bloatAlert
        ? `Session hit ${bloatAlert.metric.value}`
        : "Session sizes are healthy",
      impact: "Prevents exponential input scaling",
    },
    {
      strategy: "Cache Efficiency",
      statusEmoji: decayStatus.emoji,
      statusLabel: decayStatus.label,
      metricDesc: decayAlert
        ? `${decayAlert.metric.value} idle gap detected`
        : "No cache decay events today",
      impact: "10x cheaper reads vs. full cache writes",
    },
    {
      strategy: "Prompt Batching",
      statusEmoji: microTurnStatus.emoji,
      statusLabel: microTurnStatus.label,
      metricDesc: microTurnAlert
        ? `${microTurnAlert.metric.value} in one session`
        : "No rapid-fire sequences detected",
      impact: "Reduces context resend overhead per turn",
    },
    {
      strategy: "Context Referencing",
      statusEmoji: rawPasteStatus.emoji,
      statusLabel: rawPasteStatus.label,
      metricDesc: rawPasteAlert
        ? `${rawPasteAlert.metric.value} uncached input spike`
        : "No uncached paste spikes detected",
      impact: "Cache hits cost ~10x less than raw input",
    },
    {
      strategy: "Model Routing",
      statusEmoji: premiumStatus.emoji,
      statusLabel: premiumStatus.label,
      metricDesc: premiumAlert
        ? `${premiumAlert.metric.value} high-cost trivial turns`
        : "No premium model misallocation today",
      impact: "Lighter models use 5–20x fewer credits",
    },
    {
      strategy: "Agent Scoping",
      statusEmoji: massiveStatus.emoji,
      statusLabel: massiveStatus.label,
      metricDesc: massiveAlert
        ? `${massiveAlert.metric.value} in one turn`
        : "No massive context turns today",
      impact: "Constraining scope eliminates wasted scans",
    },
  ];
}
