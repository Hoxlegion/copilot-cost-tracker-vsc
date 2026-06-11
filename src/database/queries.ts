import type { Database } from "sql.js";
import type { AggregatedCost, ModelBreakdown, AgentBreakdown, DailyAgentBreakdown, ModelLatencySample, SessionSummary, SessionModelBreakdownRow, StoredTurn, SessionContextInfo, ContextTimelinePoint, SessionContextDistribution } from "./types";

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function getModelLatencySamples(db: Database, days: number = 30, workspace?: string): ModelLatencySample[] {
  const safeDays = clampInt(days, 1, 3650);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const stmt = db.prepare(`
    SELECT model_family, duration
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
    ORDER BY model_family, duration
  `);
  stmt.bind({ ":since": since, ":workspace": workspace ?? null });

  const rows: ModelLatencySample[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({ model: row.model_family as string, duration: row.duration as number });
  }
  stmt.free();
  return rows;
}

function resolveSince(daysOrSinceMs: number, isSinceMs: boolean): number {
  if (isSinceMs) {
    return Number.isFinite(daysOrSinceMs) ? Math.floor(daysOrSinceMs) : 0;
  }
  return Date.now() - clampInt(daysOrSinceMs, 1, 3650) * 24 * 60 * 60 * 1000;
}

export function getDailyCosts(db: Database, daysOrSinceMs: number = 30, workspace?: string, isSinceMs: boolean = false): AggregatedCost[] {
  const since = resolveSince(daysOrSinceMs, isSinceMs);

  const stmt = db.prepare(`
    SELECT
      date(timestamp / 1000, 'unixepoch') as period,
      SUM(cost_usd) as total_cost_usd,
      SUM(credits) as total_credits,
      COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
    GROUP BY period
    ORDER BY period DESC
  `);
  stmt.bind({ ":since": since, ":workspace": workspace ?? null });

  const rows: AggregatedCost[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      period: row.period as string,
      totalCostUsd: row.total_cost_usd as number,
      totalCredits: row.total_credits as number,
      turnCount: row.turn_count as number,
    });
  }
  stmt.free();
  return rows;
}

export function getDailyCostsSince(db: Database, sinceMs: number, workspace?: string): AggregatedCost[] {
  return getDailyCosts(db, sinceMs, workspace, true);
}

export function getModelBreakdown(db: Database, daysOrSinceMs: number = 30, workspace?: string, isSinceMs: boolean = false): ModelBreakdown[] {
  const since = resolveSince(daysOrSinceMs, isSinceMs);

  const stmt = db.prepare(`
    SELECT
      model_family,
      SUM(cost_usd) as total_cost_usd,
      SUM(credits) as total_credits,
      COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
    GROUP BY model_family
    ORDER BY total_cost_usd DESC
  `);
  stmt.bind({ ":since": since, ":workspace": workspace ?? null });

  const rows: ModelBreakdown[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      model: row.model_family as string,
      totalCostUsd: row.total_cost_usd as number,
      totalCredits: row.total_credits as number,
      turnCount: row.turn_count as number,
      percentage: 0,
    });
  }
  stmt.free();

  const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
  for (const row of rows) {
    row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
  }
  return rows;
}

export function getModelBreakdownSince(db: Database, sinceMs: number, workspace?: string): ModelBreakdown[] {
  return getModelBreakdown(db, sinceMs, workspace, true);
}

export function getAgentBreakdown(db: Database, daysOrSinceMs: number = 30, workspace?: string, isSinceMs: boolean = false): AgentBreakdown[] {
  const since = resolveSince(daysOrSinceMs, isSinceMs);

  const stmt = db.prepare(`
    SELECT agent_name, SUM(cost_usd) as total_cost_usd, SUM(credits) as total_credits, COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
    GROUP BY agent_name
    ORDER BY total_cost_usd DESC
  `);
  stmt.bind({ ":since": since, ":workspace": workspace ?? null });

  const rows: AgentBreakdown[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      agentName: (row.agent_name as string) || "unknown",
      totalCostUsd: row.total_cost_usd as number,
      totalCredits: row.total_credits as number,
      turnCount: row.turn_count as number,
      percentage: 0,
    });
  }
  stmt.free();

  const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
  for (const row of rows) {
    row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
  }
  return rows;
}

export function getAgentBreakdownSince(db: Database, sinceMs: number, workspace?: string): AgentBreakdown[] {
  return getAgentBreakdown(db, sinceMs, workspace, true);
}

export function getDailyAgentBreakdown(db: Database, days: number = 365, workspace?: string): DailyAgentBreakdown[] {
  const safeDays = clampInt(days, 1, 3650);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

  const stmt = db.prepare(`
    SELECT
      date(timestamp / 1000, 'unixepoch') as period,
      agent_name,
      SUM(cost_usd) as total_cost_usd,
      SUM(credits) as total_credits,
      COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
    GROUP BY period, agent_name
    ORDER BY period ASC, total_cost_usd DESC
  `);
  stmt.bind({ ":since": since, ":workspace": workspace ?? null });

  const rows: DailyAgentBreakdown[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      period: row.period as string,
      agentName: (row.agent_name as string) || "unknown",
      totalCostUsd: row.total_cost_usd as number,
      totalCredits: row.total_credits as number,
      turnCount: row.turn_count as number,
    });
  }
  stmt.free();
  return rows;
}

export function getCurrentMonthTotal(db: Database, workspace?: string): { costUsd: number; credits: number; turns: number } {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const stmt = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(credits), 0) as total_credits,
      COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :monthStart
      AND (:workspace IS NULL OR workspace = :workspace)
  `);
  stmt.bind({ ":monthStart": monthStart, ":workspace": workspace ?? null });

  if (!stmt.step()) {
    stmt.free();
    return { costUsd: 0, credits: 0, turns: 0 };
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    costUsd: row.total_cost as number,
    credits: row.total_credits as number,
    turns: row.turn_count as number,
  };
}

export function getCreditsSince(db: Database, sinceMs: number): number {
  const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
  const stmt = db.prepare("SELECT COALESCE(SUM(credits), 0) as total_credits FROM turns WHERE timestamp >= :since");
  stmt.bind({ ":since": safeSince });
  if (!stmt.step()) {
    stmt.free();
    return 0;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row.total_credits as number;
}

export function getMostRecentModel(db: Database): string | null {
  const result = db.exec("SELECT model_family FROM turns ORDER BY timestamp DESC LIMIT 1");
  if (result.length === 0 || result[0].values.length === 0) return null;
  return (result[0].values[0][0] as string) || null;
}

export function getCostSince(db: Database, sinceMs: number, workspace?: string): { costUsd: number; credits: number; turns: number } {
  const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
  const stmt = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(credits), 0) as total_credits,
      COUNT(*) as turn_count
    FROM turns
    WHERE timestamp >= :since
      AND (:workspace IS NULL OR workspace = :workspace)
  `);
  stmt.bind({ ":since": safeSince, ":workspace": workspace ?? null });

  if (!stmt.step()) {
    stmt.free();
    return { costUsd: 0, credits: 0, turns: 0 };
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    costUsd: row.total_cost as number,
    credits: row.total_credits as number,
    turns: row.turn_count as number,
  };
}

export function getWorkspaces(db: Database): string[] {
  const result = db.exec("SELECT DISTINCT workspace FROM turns ORDER BY workspace");
  if (result.length === 0) return [];
  return result[0].values.map((row) => row[0] as string);
}

export function getSessionSummaries(db: Database, workspace?: string, limit: number = 50): SessionSummary[] {
  const safeLimit = clampInt(limit, 1, 500);
  const stmt = db.prepare(`
    SELECT
      t.session_id,
      t.workspace,
      MIN(t.timestamp) as start_timestamp,
      MAX(t.timestamp) as last_timestamp,
      COUNT(*) as turn_count,
      SUM(t.input_tokens) as total_input_tokens,
      SUM(t.output_tokens) as total_output_tokens,
      SUM(t.cached_tokens) as total_cached_tokens,
      SUM(t.cost_usd) as total_cost_usd,
      SUM(t.credits) as total_credits,
      AVG(t.duration) as avg_duration_ms,
      pm.primary_model,
      s.title
    FROM turns t
    LEFT JOIN (
      SELECT session_id, model_family AS primary_model,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY COUNT(*) DESC) AS rn
      FROM turns
      GROUP BY session_id, model_family
    ) pm ON pm.session_id = t.session_id AND pm.rn = 1
    LEFT JOIN sessions s ON s.session_id = t.session_id
    WHERE (:workspace IS NULL OR t.workspace = :workspace)
    GROUP BY t.session_id, t.workspace
    HAVING (total_cost_usd > 0 OR total_input_tokens > 0)
      AND NOT (turn_count <= 2 AND total_cost_usd = 0)
    ORDER BY start_timestamp DESC
    LIMIT :limit
  `);
  stmt.bind({ ":workspace": workspace ?? null, ":limit": safeLimit });

  const rows: SessionSummary[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      sessionId: row.session_id as string,
      workspace: row.workspace as string,
      startTimestamp: row.start_timestamp as number,
      lastTimestamp: row.last_timestamp as number,
      turnCount: row.turn_count as number,
      totalInputTokens: row.total_input_tokens as number,
      totalOutputTokens: row.total_output_tokens as number,
      totalCachedTokens: row.total_cached_tokens as number,
      totalCostUsd: row.total_cost_usd as number,
      totalCredits: row.total_credits as number,
      avgDurationMs: row.avg_duration_ms as number,
      primaryModel: row.primary_model as string,
      title: (row.title as string) ?? null,
    });
  }
  stmt.free();
  return rows;
}

export function getSessionModelBreakdowns(db: Database, sessionIds: string[]): SessionModelBreakdownRow[] {
  if (sessionIds.length === 0) return [];

  const uniqueSessionIds = Array.from(new Set(sessionIds.filter((id) => id.trim().length > 0)));
  if (uniqueSessionIds.length === 0) return [];

  const rows: SessionModelBreakdownRow[] = [];
  const chunkSize = 300;

  for (let i = 0; i < uniqueSessionIds.length; i += chunkSize) {
    const chunk = uniqueSessionIds.slice(i, i + chunkSize);
    const placeholders = chunk.map((_id, idx) => `:sid${idx}`).join(", ");
    const stmt = db.prepare(`
      SELECT
        session_id,
        model_family,
        COUNT(*) as turn_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits
      FROM turns
      WHERE session_id IN (${placeholders})
      GROUP BY session_id, model_family
      ORDER BY session_id ASC, total_cost_usd DESC
    `);

    const bindings: Record<string, string> = {};
    chunk.forEach((sessionId, idx) => {
      bindings[`:sid${idx}`] = sessionId;
    });
    stmt.bind(bindings);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        sessionId: row.session_id as string,
        model: row.model_family as string,
        turnCount: row.turn_count as number,
        totalInputTokens: row.total_input_tokens as number,
        totalOutputTokens: row.total_output_tokens as number,
        totalCachedTokens: row.total_cached_tokens as number,
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
      });
    }
    stmt.free();
  }
  return rows;
}

export function getTurnsForSession(db: Database, sessionId: string, limit: number = 50): StoredTurn[] {
  const stmt = db.prepare(
    `SELECT id, session_id, timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens, cost_usd, credits, workspace, status
     FROM turns
     WHERE session_id = :sessionId
     ORDER BY timestamp DESC
     LIMIT :limit`
  );
  stmt.bind({ ":sessionId": sessionId, ":limit": limit });

  const rows: StoredTurn[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      id: row.id as number,
      sessionId: row.session_id as string,
      timestamp: row.timestamp as number,
      duration: row.duration as number,
      agentName: row.agent_name as string,
      model: row.model as string,
      modelFamily: row.model_family as string,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cachedTokens: row.cached_tokens as number,
      cacheWriteTokens: row.cache_write_tokens as number,
      totalTokens: row.total_tokens as number,
      costUsd: row.cost_usd as number,
      credits: row.credits as number,
      workspace: row.workspace as string,
      status: row.status as string,
    });
  }
  stmt.free();
  return rows;
}

export function getMaxTimestamp(db: Database): number {
  const result = db.exec("SELECT MAX(timestamp) FROM turns");
  if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] != null) {
    return result[0].values[0][0] as number;
  }
  return 0;
}

export function isSessionProcessed(db: Database, sessionId: string): boolean {
  const stmt = db.prepare("SELECT 1 FROM sessions WHERE session_id = :sessionId LIMIT 1");
  stmt.bind({ ":sessionId": sessionId });
  const found = stmt.step();
  stmt.free();
  return found;
}

export function getSessionLastTimestamp(db: Database, sessionId: string): number | null {
  const stmt = db.prepare("SELECT last_timestamp FROM sessions WHERE session_id = :sessionId LIMIT 1");
  stmt.bind({ ":sessionId": sessionId });
  let lastTimestamp: number | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    lastTimestamp = (row.last_timestamp as number) ?? null;
  }
  stmt.free();
  return lastTimestamp;
}

export function getMostRecentSessionContext(db: Database, sinceMs: number): SessionContextInfo | null {
  const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
  const stmt = db.prepare(`
    SELECT 
      session_id,
      COUNT(*) AS turn_count,
      MAX(timestamp) AS last_activity_ms,
      MIN(timestamp) AS first_activity_ms,
      (SELECT input_tokens + cached_tokens 
       FROM turns t2 
       WHERE t2.session_id = t1.session_id 
       ORDER BY timestamp DESC LIMIT 1) AS current_context_weight
    FROM turns t1
    WHERE timestamp >= :since
    GROUP BY session_id
    ORDER BY last_activity_ms DESC
    LIMIT 1
  `);
  stmt.bind({ ":since": safeSince });

  let result: SessionContextInfo | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    result = {
      sessionId: row.session_id as string,
      turnCount: row.turn_count as number,
      lastActivityMs: row.last_activity_ms as number,
      firstActivityMs: row.first_activity_ms as number,
      currentContextWeight: (row.current_context_weight as number) || 0,
    };
  }
  stmt.free();
  return result;
}

export function getSessionContextTimeline(db: Database, sessionId: string): ContextTimelinePoint[] {
  const stmt = db.prepare(`
    SELECT 
      timestamp, 
      input_tokens, 
      cached_tokens, 
      output_tokens,
      (input_tokens + cached_tokens) AS current_context_weight
    FROM turns
    WHERE session_id = :sessionId
    ORDER BY timestamp ASC
  `);
  stmt.bind({ ":sessionId": sessionId });

  const rows: ContextTimelinePoint[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      timestamp: row.timestamp as number,
      inputTokens: row.input_tokens as number,
      cachedTokens: row.cached_tokens as number,
      outputTokens: row.output_tokens as number,
      currentContextWeight: (row.current_context_weight as number) || 0,
    });
  }
  stmt.free();
  return rows;
}

export function getSessionContextDistribution(db: Database, sinceMs: number): SessionContextDistribution[] {
  const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
  const stmt = db.prepare(`
    SELECT 
      session_id,
      (SELECT input_tokens + cached_tokens 
       FROM turns t2 
       WHERE t2.session_id = t1.session_id 
       ORDER BY timestamp DESC LIMIT 1) AS current_context_weight,
      (SELECT workspace 
       FROM turns t3 
       WHERE t3.session_id = t1.session_id 
       ORDER BY timestamp ASC LIMIT 1) AS workspace,
      COUNT(*) AS turn_count,
      MIN(timestamp) AS start_ms,
      MAX(timestamp) AS last_ms,
      SUM(cost_usd) AS total_cost
    FROM turns t1
    WHERE timestamp >= :since
    GROUP BY session_id
    HAVING COUNT(*) >= 2
    ORDER BY current_context_weight DESC
  `);
  stmt.bind({ ":since": safeSince });

  const rows: SessionContextDistribution[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      sessionId: row.session_id as string,
      currentContextWeight: (row.current_context_weight as number) || 0,
      turnCount: row.turn_count as number,
      startMs: row.start_ms as number,
      lastMs: row.last_ms as number,
      totalCost: (row.total_cost as number) || 0,
      workspace: (row.workspace as string) || "unknown",
    });
  }
  stmt.free();
  return rows;
}
