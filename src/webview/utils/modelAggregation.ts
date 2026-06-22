import type { SessionEntry } from '../types';

export interface AggregatedModel {
  model: string;
  totalCostUsd: number;
  totalCredits: number;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  percentage: number;
}

/**
 * Aggregate per-model totals across a set of sessions using each session's
 * accurate per-model breakdown (not the session's single "primary model").
 *
 * This correctly attributes cost/tokens/turns for sessions that used more than
 * one model. Falls back to the primary model only when a session has no
 * breakdown rows (e.g. older data). Results are sorted by cost descending with
 * a `percentage` of total cost attached.
 */
export function aggregateModelsFromSessions(sessions: SessionEntry[]): AggregatedModel[] {
  const map = new Map<string, AggregatedModel>();

  const add = (
    model: string,
    costUsd: number,
    credits: number,
    turns: number,
    input: number,
    output: number,
    cached: number,
  ): void => {
    const cur = map.get(model) ?? {
      model,
      totalCostUsd: 0,
      totalCredits: 0,
      turnCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      percentage: 0,
    };
    cur.totalCostUsd += costUsd;
    cur.totalCredits += credits;
    cur.turnCount += turns;
    cur.totalInputTokens += input;
    cur.totalOutputTokens += output;
    cur.totalCachedTokens += cached;
    map.set(model, cur);
  };

  for (const s of sessions) {
    if (s.modelBreakdown && s.modelBreakdown.length > 0) {
      for (const m of s.modelBreakdown) {
        add(m.model, m.totalCostUsd, m.totalCredits, m.turnCount, m.totalInputTokens, m.totalOutputTokens, m.totalCachedTokens);
      }
    } else {
      add(s.primaryModel, s.totalCostUsd, s.totalCredits, s.turnCount, s.totalInputTokens, s.totalOutputTokens, s.totalCachedTokens);
    }
  }

  const models = Array.from(map.values());
  const totalCost = models.reduce((sum, m) => sum + m.totalCostUsd, 0);
  for (const m of models) {
    m.percentage = totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0;
  }
  return models.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}
