import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
import type { ParsedTurn } from "../src/parser/types";

let spanCounter = 0;

function call(sessionId: string, timestamp: number, prompt: number, overrides: Partial<ParsedTurn> = {}): ParsedTurn {
  const cachedTokens = Math.floor(prompt * 0.9);
  const inputTokens = prompt - cachedTokens;
  return {
    sessionId,
    spanId: `span-${++spanCounter}`,
    timestamp,
    duration: 1_000,
    agentName: "panel/editAgent",
    model: "gpt-5",
    modelFamily: "gpt-5",
    inputTokens,
    outputTokens: 500,
    cachedTokens,
    cacheWriteTokens: 0,
    totalTokens: prompt + 500,
    status: "ok",
    costSource: "real",
    ...overrides,
  };
}

describe("context insights", () => {
  let storageDir: string;
  let database: CostDatabase;

  beforeEach(async () => {
    setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
    storageDir = await mkdtemp(join(tmpdir(), "context-insights-"));
    database = new CostDatabase(storageDir);
    await database.initialize();
  });

  afterEach(async () => {
    database.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  const add = (turn: ParsedTurn, credits = 1) => database.insertTurn(turn, credits / 100, credits, "Org/Repo");

  describe("active chat session", () => {
    it("ignores calls without a chat session and subagent sessions", () => {
      add(call("chat-a", 1_000, 40_000));
      add(call("unknown", 5_000, 3_000, { agentName: "XtabProvider", model: "copilot-nes-oct", modelFamily: "copilot-nes-oct" }));
      add(call("subagent-1", 6_000, 20_000, { agentName: "tool/runSubagent-Explore" }));

      expect(database.getMostRecentSessionContext(0)).toMatchObject({ sessionId: "chat-a", currentContextWeight: 40_000 });
    });

    it("reads the chat's context from its own calls while counting a shared subagent's cost", () => {
      add(call("chat-a", 1_000, 40_000), 3);
      add(call("chat-a", 2_000, 45_000), 4);
      add(call("chat-a", 3_000, 12_000, { agentName: "tool/runSubagent" }), 2);

      expect(database.getMostRecentSessionContext(0)).toMatchObject({
        sessionId: "chat-a",
        currentContextWeight: 45_000,
        turnCount: 3,
        lastActivityMs: 3_000,
        credits: 9,
      });
    });
  });
});
