import type { TurnDiscoveryRow } from "./types";

interface Accumulator {
  chatSessionId: string;
  turnIndex: number;
  firstTimeMs: number;
  lastTimeMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  models: Set<string>;
  agents: Set<string>;
  tools: Set<string>;
}

const TURN_GAP_MS = 20_000;

function resolveTurnIndex(
  rawTurnIndex: unknown,
  chatSessionId: string,
  startTimeMs: number,
  sessionState: Map<string, { index: number; lastTs: number }>
): number {
  if (rawTurnIndex === null || rawTurnIndex === undefined || rawTurnIndex === "") {
    const current = sessionState.get(chatSessionId);
    if (!current) {
      sessionState.set(chatSessionId, { index: 0, lastTs: startTimeMs });
      return 0;
    }
    if (startTimeMs - current.lastTs > TURN_GAP_MS) {
      current.index += 1;
    }
    current.lastTs = Math.max(current.lastTs, startTimeMs);
    return current.index;
  }

  const turnIndex = Number(rawTurnIndex);
  const current = sessionState.get(chatSessionId);
  if (current) {
    current.index = Math.max(current.index, turnIndex);
    current.lastTs = Math.max(current.lastTs, startTimeMs);
  } else {
    sessionState.set(chatSessionId, { index: turnIndex, lastTs: startTimeMs });
  }
  return turnIndex;
}

function updateAccumulator(acc: Accumulator, row: unknown[]): void {
  const startTimeMs = Number(row[2] ?? 0);
  const endTimeMs = Number(row[3] ?? 0);
  const agentName = (row[4] as string | null) ?? "unknown";
  const requestModel = (row[5] as string | null) ?? "";
  const responseModel = (row[6] as string | null) ?? "";
  const inputTokens = Number(row[7] ?? 0);
  const outputTokens = Number(row[8] ?? 0);
  const cachedTokens = Number(row[9] ?? 0);
  const toolName = (row[10] as string | null) ?? "";

  acc.firstTimeMs = Math.min(acc.firstTimeMs, startTimeMs || acc.firstTimeMs);
  acc.lastTimeMs = Math.max(acc.lastTimeMs, endTimeMs || startTimeMs || acc.lastTimeMs);
  // `input_tokens` from telemetry includes `cached_tokens` (cache reads are a subset of
  // the prompt). Store only the non-cached portion so `inputTokens + cachedTokens` equals
  // the full prompt and cache-hit math stays correct.
  acc.inputTokens += Math.max(0, inputTokens - cachedTokens);
  acc.outputTokens += outputTokens;
  acc.cachedTokens += cachedTokens;

  const model = responseModel || requestModel;
  if (model) acc.models.add(model);
  if (agentName) acc.agents.add(agentName);

  if ((inputTokens + outputTokens + cachedTokens) > 0) {
    acc.llmCalls += 1;
  }

  if (toolName) {
    acc.toolCalls += 1;
    acc.tools.add(toolName);
  }
}

export function buildTurnDiscovery(rows: unknown[][]): TurnDiscoveryRow[] {
  const grouped = new Map<string, Accumulator>();
  const sessionState = new Map<string, { index: number; lastTs: number }>();

  for (const row of rows) {
    const chatSessionId = (row[0] as string) || "";
    const startTimeMs = Number(row[2] ?? 0);
    const endTimeMs = Number(row[3] ?? 0);

    const turnIndex = resolveTurnIndex(row[1], chatSessionId, startTimeMs, sessionState);

    const key = `${chatSessionId}::${turnIndex}`;
    const acc = grouped.get(key) ?? {
      chatSessionId,
      turnIndex,
      firstTimeMs: startTimeMs,
      lastTimeMs: endTimeMs || startTimeMs,
      llmCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      models: new Set<string>(),
      agents: new Set<string>(),
      tools: new Set<string>(),
    };

    updateAccumulator(acc, row);
    grouped.set(key, acc);
  }

  const result = Array.from(grouped.values()).map((acc) => {
    const billableInput = acc.inputTokens + acc.cachedTokens;
    const cacheHitPct = billableInput > 0 ? (acc.cachedTokens / billableInput) * 100 : 0;
    return {
      chatSessionId: acc.chatSessionId,
      turnIndex: acc.turnIndex,
      firstTimeMs: acc.firstTimeMs,
      lastTimeMs: acc.lastTimeMs,
      llmCalls: acc.llmCalls,
      toolCalls: acc.toolCalls,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cachedTokens: acc.cachedTokens,
      cacheHitPct,
      models: Array.from(acc.models).sort((a, b) => a.localeCompare(b)),
      agents: Array.from(acc.agents).sort((a, b) => a.localeCompare(b)),
      tools: Array.from(acc.tools).sort((a, b) => a.localeCompare(b)),
    };
  });

  result.sort((a, b) => b.lastTimeMs - a.lastTimeMs);
  return result;
}
