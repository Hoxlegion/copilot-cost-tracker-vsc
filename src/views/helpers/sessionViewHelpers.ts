import { resolveWorkspaceName } from "./workspaceResolver";

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildWorkspaceSummaryView(allSessions: Array<{
  sessionId: string;
  workspace: string;
  lastTimestamp: number;
  turnCount: number;
  totalCostUsd: number;
  totalCredits: number;
}>): {
  topWorkspaceLabel: string;
  topWorkspaceCostUsd: number;
  topWorkspaceSessions: number;
  workspaceRowsHtml: string;
  lastUpdatedMs: number;
} {
  const byWorkspace = new Map<string, {
    workspace: string; displayName: string; costUsd: number; credits: number; sessions: number; turns: number; lastTimestamp: number;
  }>();

  let lastUpdatedMs = 0;
  for (const s of allSessions) {
    const key = s.workspace || "unknown";
    const current = byWorkspace.get(key) ?? {
      workspace: key, displayName: resolveWorkspaceName(key), costUsd: 0, credits: 0, sessions: 0, turns: 0, lastTimestamp: 0,
    };
    current.costUsd += s.totalCostUsd;
    current.credits += s.totalCredits;
    current.sessions += 1;
    current.turns += s.turnCount;
    current.lastTimestamp = Math.max(current.lastTimestamp, s.lastTimestamp || 0);
    byWorkspace.set(key, current);
    lastUpdatedMs = Math.max(lastUpdatedMs, s.lastTimestamp || 0);
  }

  const rows = Array.from(byWorkspace.values()).sort((a, b) => b.costUsd - a.costUsd).slice(0, 6);
  const top = rows[0];

  const workspaceRowsHtml = rows.length === 0
    ? `<tr><td colspan="5" style="color:var(--muted)">No workspace data yet</td></tr>`
    : rows.map((r) =>
      `<tr>
        <td title="${escapeAttr(r.workspace)}">${r.displayName}</td>
        <td class="num">$${r.costUsd.toFixed(3)}</td>
        <td class="num">${r.credits.toFixed(1)}</td>
        <td class="num">${r.sessions}</td>
        <td class="num">${r.turns}</td>
      </tr>`
    ).join("");

  return {
    topWorkspaceLabel: top ? top.displayName : "—",
    topWorkspaceCostUsd: top?.costUsd ?? 0,
    topWorkspaceSessions: top?.sessions ?? 0,
    workspaceRowsHtml,
    lastUpdatedMs,
  };
}

export function buildRecentSessionRowsHtml(allSessions: Array<{
  sessionId: string; workspace: string; lastTimestamp: number; turnCount: number;
  primaryModel: string; totalInputTokens: number; totalCachedTokens: number; totalCostUsd: number;
  title?: string | null;
}>): string {
  const recent = [...allSessions].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0)).slice(0, 6);
  if (recent.length === 0) return `<tr><td colspan="7" style="color:var(--muted)">No recent sessions yet</td></tr>`;

  return recent.map((s) => {
    const cacheBase = s.totalInputTokens + s.totalCachedTokens;
    const cacheHitPct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0;
    const sessionLabel = s.title || (s.sessionId.length > 12 ? `${s.sessionId.slice(0, 6)}…${s.sessionId.slice(-4)}` : s.sessionId);
    const timeLabel = s.lastTimestamp > 0 ? new Date(s.lastTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
    return `<tr>
      <td>${timeLabel}</td>
      <td title="${escapeAttr(s.workspace)}">${resolveWorkspaceName(s.workspace)}</td>
      <td title="${escapeAttr(s.sessionId)}"><button class="goto-session" data-session-id="${escapeAttr(s.sessionId)}" style="background:none;border:none;color:var(--accent);cursor:pointer;padding:0">${escapeAttr(sessionLabel)}</button></td>
      <td>${s.primaryModel || "unknown"}</td>
      <td class="num">${s.turnCount}</td>
      <td class="num">${cacheHitPct.toFixed(1)}%</td>
      <td class="num">$${s.totalCostUsd.toFixed(3)}</td>
    </tr>`;
  }).join("");
}

export function formatFreshnessLabel(lastUpdatedMs: number): string {
  if (!lastUpdatedMs || !Number.isFinite(lastUpdatedMs)) return "no data";
  const diffMs = Math.max(0, Date.now() - lastUpdatedMs);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
