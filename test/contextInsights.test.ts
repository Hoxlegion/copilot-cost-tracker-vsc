import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
import { getAlerts } from "../src/insights";
import type { ParsedTurn, TurnSource } from "../src/parser/types";

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

  describe("source filter", () => {
    const cli = (sessionId: string, timestamp: number, overrides: Partial<ParsedTurn>) =>
      call(sessionId, timestamp, 0, { spanId: undefined, agentName: "copilot-cli", source: "cli", ...overrides });

    beforeEach(() => {
      add(call("chat-a", 1_000, 40_000));
      add(call("chat-a", 2_000, 90_000));
      add(call("chat-a", 3_000, 20_000, { agentName: "tool/runSubagent" }));
      // Newer CLIs write one row per request and store cache writes apart from fresh input.
      add(cli("cli-records", 4_000, { inputTokens: 1_000, cachedTokens: 30_000, cacheWriteTokens: 9_000 }));
      add(cli("cli-records", 5_000, { inputTokens: 2_000, cachedTokens: 40_000, cacheWriteTokens: 8_000 }));
      // Older CLIs write one row per session exit that combines several requests.
      add(cli("cli-legacy", 6_000, { inputTokens: 30_000, cachedTokens: 240_000, cacheWriteTokens: 30_000, requestCount: 3 }));
      add(call("unknown", 7_000, 3_000, { agentName: "XtabProvider" }));
      add(call("unknown", 8_000, 3_000, { agentName: "XtabProvider" }));
      add(call("subagent-1", 9_000, 20_000, { agentName: "tool/runSubagent-Explore" }));
      add(call("subagent-1", 10_000, 25_000, { agentName: "tool/runSubagent-Explore" }));
    });

    const distribution = (source?: TurnSource) => database.getSessionContextDistribution(0, source)
      .map((d) => [d.sessionId, d.currentContextWeight, d.turnCount]);

    it("limits the context distribution to the selected source and measures context per request", () => {
      expect(distribution("chat")).toEqual([["chat-a", 90_000, 3]]);
      expect(distribution("cli")).toEqual([["cli-legacy", 100_000, 3], ["cli-records", 50_000, 2]]);
      expect(distribution().map(([sessionId]) => sessionId)).toEqual(["cli-legacy", "chat-a", "cli-records"]);
    });

    it("draws context growth from the conversation's own requests for either source", () => {
      expect(database.getSessionContextTimeline("chat-a").map((p) => p.currentContextWeight)).toEqual([40_000, 90_000]);
      expect(database.getSessionContextTimeline("cli-records").map((p) => p.currentContextWeight)).toEqual([40_000, 50_000]);
    });

    it("computes alert metrics for the selected source from single-request rows", () => {
      const start = Date.now() - 60 * 60_000;
      add(call("chat-b", start, 100_000));
      add(cli("cli-big", start + 1_000, { inputTokens: 10_000, cachedTokens: 380_000, cacheWriteTokens: 10_000 }));
      add(cli("cli-old", start + 2_000, { inputTokens: 100_000, cachedTokens: 700_000, cacheWriteTokens: 100_000, requestCount: 2 }));

      const massive = (source?: TurnSource) => database.getAlertMetrics(start, undefined, source).massiveContextMaxInput;
      expect([massive("chat"), massive("cli"), massive()]).toEqual([0, 400_000, 400_000]);
    });
  });

  describe("dashboard alerts", () => {
    /** Agent loop: the prompt grows by `growth` per request and everything before it is cached. */
    function agentLoop(sessionId: string, start: number, requests: number, options: {
      firstPrompt?: number; growth?: number; gapMs?: number; output?: (i: number) => number; credits?: number;
    } = {}): number {
      const { firstPrompt = 33_000, growth = 2_000, gapMs = 10_000, output = (i) => (i % 2 === 0 ? 80 : 800), credits = 3 } = options;
      let prompt = firstPrompt;
      for (let i = 0; i < requests; i++) {
        const cachedTokens = i === 0 ? 0 : prompt - growth;
        add(call(sessionId, start + i * gapMs, prompt, { cachedTokens, inputTokens: prompt - cachedTokens, outputTokens: output(i) }), credits);
        prompt += growth;
      }
      return prompt - growth;
    }

    it("keeps a typical agentic day with Next Edit Suggestions free of alerts", () => {
      const start = Date.now() - 2 * 60 * 60_000;
      agentLoop("chat-a", start, 40);
      for (let i = 0; i < 50; i++) {
        add(call("unknown", start + i * 2_000, 3_000, { agentName: "XtabProvider", outputTokens: 20 }), 0);
      }

      expect(getAlerts(database)).toEqual([]);
    });

    it("measures context per request and applies the massive-context threshold", () => {
      agentLoop("chat-a", 1_000, 2, { firstPrompt: 300_000 });
      expect(database.getAlertMetrics(0)).toMatchObject({ peakContextTokens: 302_000, massiveContextMaxInput: 0 });

      agentLoop("chat-b", 100_000, 2, { firstPrompt: 400_000 });
      expect(database.getAlertMetrics(0)).toMatchObject({ peakContextTokens: 402_000, massiveContextMaxInput: 402_000 });
    });

    it("counts only new input as a paste, not cache warm-ups", () => {
      const end = agentLoop("chat-a", 1_000, 3, { firstPrompt: 120_000 });
      // Compaction: a smaller, fully uncached prompt.
      add(call("chat-a", 40_000, 30_000, { cachedTokens: 0, inputTokens: 30_000 }));
      expect(end).toBe(124_000);
      expect(database.getAlertMetrics(0).rawPasteMaxNetInput).toBe(0);

      add(call("chat-a", 50_000, 90_000, { cachedTokens: 30_000, inputTokens: 60_000 }));
      expect(database.getAlertMetrics(0).rawPasteMaxNetInput).toBe(60_000);
    });

    it("reports the longest run of rapid low-output requests within one session", () => {
      agentLoop("chat-a", 1_000, 4, { output: () => 50 });
      agentLoop("chat-b", 1_000_000, 8, { output: (i) => (i === 4 ? 900 : 50) });
      expect(database.getAlertMetrics(0).microTurnCount).toBe(0);

      agentLoop("chat-c", 2_000_000, 7, { output: () => 50 });
      expect(database.getAlertMetrics(0)).toMatchObject({ microTurnCount: 6, microTurnAvgOutput: 50 });
    });
  });
});
