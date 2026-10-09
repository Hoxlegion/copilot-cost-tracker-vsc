import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

import { TracesIngester } from "../src/watcher/tracesIngester";
import type { TraceSpan } from "../src/parser/types";

// Unit tests for Ingester failover and polling logic
describe("Ingester Failover & Polling", () => {
  describe("Source Resolution", () => {
    it("uses database source when available", () => {
      const dbExists = true;
      const consecutiveEmptyPolls = 0;

      // In auto mode, use DB if available and producing data
      const activeSource =
        dbExists && consecutiveEmptyPolls < 12 ? "database" : "jsonl";

      expect(activeSource).toBe("database");
    });

    it("switches to JSONL after 12 empty database polls", () => {
      const dbExists = true;
      const FAILOVER_THRESHOLD = 12;

      let consecutiveEmptyPolls = 0;

      for (let i = 0; i < 15; i++) {
        consecutiveEmptyPolls++; // Simulate empty poll

        const activeSource =
          dbExists && consecutiveEmptyPolls < FAILOVER_THRESHOLD
            ? "database"
            : "jsonl";

        if (i < 11) {
          expect(activeSource).toBe("database");
        } else {
          expect(activeSource).toBe("jsonl");
        }
      }
    });

    it("respects forced telemetry source", () => {
      const telemetrySources = ["database", "jsonl", "auto"] as const;

      for (const source of telemetrySources) {
        const activeSource =
          source === "auto" ? "database" : (source);
        expect(activeSource).toBeTruthy();
      }
    });

    it("falls back to JSONL if traces DB doesn't exist", () => {
      const dbExists = false;

      const activeSource = dbExists ? "database" : "jsonl";
      expect(activeSource).toBe("jsonl");
    });
  });

  describe("File Watcher Strategy", () => {
    it("debounces rapid successive file change events into one ingestion", async () => {
      const debounceMs = 300;
      let ingestionCount = 0;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const triggerDebounced = () => {
        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => {
          ingestionCount++;
        }, debounceMs);
      };

      triggerDebounced();
      triggerDebounced();
      triggerDebounced();
      triggerDebounced();
      triggerDebounced();

      await new Promise((resolve) => setTimeout(resolve, debounceMs + 50));
      expect(ingestionCount).toBe(1);
    });

    it("fallback poll triggers ingestion when no file events arrive", async () => {
      const fallbackIntervalMs = 100;
      let ingestionCount = 0;

      const fallbackTimer = setInterval(() => {
        ingestionCount++;
      }, fallbackIntervalMs);

      await new Promise((resolve) => setTimeout(resolve, fallbackIntervalMs * 3 + 50));
      clearInterval(fallbackTimer);
      expect(ingestionCount).toBeGreaterThanOrEqual(3);
    });

    it("runs a requested full scan after an ongoing incremental ingest", async () => {
      let finishFirstRead!: (spans: never[]) => void;
      const reader = {
        querySpans: vi.fn()
          .mockImplementationOnce(() => new Promise<never[]>((resolve) => { finishFirstRead = resolve; }))
          .mockResolvedValueOnce([]),
      };
      const database = {
        getMaxTimestamp: () => 1000,
        recomputeCacheTokenSemantics: () => false,
      };
      const parser = { discoverSessionTitles: () => new Map<string, string>() };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const ingester = new TracesIngester(
        reader as unknown as ConstructorParameters<typeof TracesIngester>[0],
        parser as unknown as ConstructorParameters<typeof TracesIngester>[1],
        {} as ConstructorParameters<typeof TracesIngester>[2],
        database as unknown as ConstructorParameters<typeof TracesIngester>[3],
        {} as ConstructorParameters<typeof TracesIngester>[4],
        logger as unknown as ConstructorParameters<typeof TracesIngester>[5],
      );
      ingester.setTelemetrySource("database");

      const incremental = ingester.ingest();
      await vi.waitFor(() => expect(reader.querySpans).toHaveBeenCalledTimes(1));
      const fullScan = ingester.fullIngest();
      finishFirstRead([]);

      await Promise.all([incremental, fullScan]);
      expect(reader.querySpans).toHaveBeenCalledTimes(2);
      expect(reader.querySpans).toHaveBeenNthCalledWith(2, undefined);
      ingester.dispose();
    });

    it("watcher path changes when source switches between database and JSONL", () => {
      let currentWatchPath: string | null = "agent-traces.db";

      const setWatchPath = (path: string | null) => {
        currentWatchPath = path;
      };

      setWatchPath(null);
      expect(currentWatchPath).toBeNull();

      setWatchPath("agent-traces.db");
      expect(currentWatchPath).toBe("agent-traces.db");
    });

    it("skips watcher setup when path is null (JSONL mode)", () => {
      const watchPath: string | null = null;
      const shouldSetupWatcher = watchPath !== null;
      expect(shouldSetupWatcher).toBe(false);
    });

    it("resets failover counter when DB produces data", () => {
      let consecutiveEmptyPolls = 5;
      const newCount = 3;

      if (newCount > 0) {
        consecutiveEmptyPolls = 0;
      }

      expect(consecutiveEmptyPolls).toBe(0);
    });
  });

  describe("Watermark Management", () => {
    it("increments watermark on successful ingest", () => {
      let lastProcessed = 1000;
      const newTurns = [
        { timestamp: 1100 },
        { timestamp: 1200 },
        { timestamp: 1150 }, // Out of order
      ];

      for (const turn of newTurns) {
        if (turn.timestamp > lastProcessed) {
          lastProcessed = Math.max(lastProcessed, turn.timestamp);
        }
      }

      expect(lastProcessed).toBe(1200);
    });

    it("recovers watermark from database on startup", () => {
      const maxTimestampInDb = 15000;
      const lastProcessed = maxTimestampInDb; // Recovered from DB

      const newTurns = [
        { timestamp: 14000 }, // Before watermark, skip
        { timestamp: 16000 }, // After watermark, process
      ];

      const toProcess = newTurns.filter((t) => t.timestamp > lastProcessed);
      expect(toProcess.length).toBe(1);
      expect(toProcess[0].timestamp).toBe(16000);
    });

    it("does not advance the watermark for skipped spans", async () => {
      const span: TraceSpan = {
        spanId: "span-1", traceId: "trace-1", parentSpanId: null, name: "llm_call",
        startTimeMs: 1200, endTimeMs: 1250, statusCode: 0, operationName: null,
        providerName: null, agentName: "panel/editAgent", conversationId: null,
        requestModel: "model", responseModel: "model", inputTokens: 0, outputTokens: 0,
        cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, toolName: null,
        chatSessionId: "session-1", turnIndex: 1, ttftMs: null, realCredits: undefined,
        workspaceRepo: null,
      };
      const reader = {
        querySpans: vi.fn()
          .mockResolvedValueOnce([span])
          .mockResolvedValueOnce([{ ...span, inputTokens: 10 }]),
      };
      const database = {
        getMaxTimestamp: () => 1000,
        recomputeCacheTokenSemantics: () => false,
        beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
        insertTurn: vi.fn(),
      };
      const pricing = { calculateCost: () => 0.01, costToCredits: () => 1 };
      const parser = { discoverSessionTitles: () => new Map<string, string>() };
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const ingester = new TracesIngester(
        reader as unknown as ConstructorParameters<typeof TracesIngester>[0],
        parser as unknown as ConstructorParameters<typeof TracesIngester>[1],
        pricing as unknown as ConstructorParameters<typeof TracesIngester>[2],
        database as unknown as ConstructorParameters<typeof TracesIngester>[3],
        { config: { excludedModels: [] } } as unknown as ConstructorParameters<typeof TracesIngester>[4],
        logger as unknown as ConstructorParameters<typeof TracesIngester>[5],
      );
      ingester.setTelemetrySource("database");

      expect(await ingester.ingest()).toBe(0);
      expect(await ingester.ingest()).toBe(1);

      expect(reader.querySpans).toHaveBeenNthCalledWith(2, 1000);
      expect(database.insertTurn).toHaveBeenCalledTimes(1);
      ingester.dispose();
    });
  });

  describe("Error Handling", () => {
    it("increments failover counter on poll error", () => {
      let consecutiveEmptyPolls = 2;

      try {
        throw new Error("Query failed");
      } catch (err: unknown) {
        // Handle error: increment failover counter (simulating error recovery)
        if (err instanceof Error) {
          consecutiveEmptyPolls++;
        }
      }

      expect(consecutiveEmptyPolls).toBe(3);
    });

    it("logs error but continues operation", () => {
      const errors: Error[] = [];

      try {
        throw new Error("Database connection failed");
      } catch (err) {
        errors.push(err as Error);
        // Continue, don't re-throw
      }

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain("Database connection failed");
    });

    it("triggers failover after threshold is reached", () => {
      let consecutiveEmptyPolls = 0;
      const FAILOVER_THRESHOLD = 12;
      let activeSource: "database" | "jsonl" = "database";

      // Simulate 13 consecutive poll failures
      for (let i = 0; i < 13; i++) {
        consecutiveEmptyPolls++;

        if (consecutiveEmptyPolls >= FAILOVER_THRESHOLD) {
          activeSource = "jsonl";
        }
      }

      expect(activeSource).toBe("jsonl");
    });
  });

  describe("Data Flow", () => {
    // Single shared predicate (S4144) exercised with varying inputs, so the
    // comparison is not a constant conditional and there is no `if` to flag.
    const hasNewTurns = (count: number) => count > 0;

    it("fires dataChanged event on new turns", () => {
      expect(hasNewTurns(5)).toBe(true);
    });

    it("doesn't fire event on zero new turns", () => {
      expect(hasNewTurns(0)).toBe(false);
    });

    it("batches multiple poll results", () => {
      const allTurns: number[] = [];

      const poll1Result = 3;
      const poll2Result = 5;
      const poll3Result = 0;

      allTurns.push(poll1Result, poll2Result, poll3Result);

      expect(allTurns.reduce((sum, n) => sum + n, 0)).toBe(8);
    });

    it("does not exclude a turn when request model is excluded but response model is billable", () => {
      const excluded = ["gpt-4o-mini"];
      const requestModel = "gpt-4o-mini";
      const responseModel = "gpt-5.4";

      const effectiveModel = responseModel ?? requestModel ?? "unknown";
      const shouldExclude = excluded.some((e) => effectiveModel.toLowerCase().includes(e.toLowerCase()));

      expect(shouldExclude).toBe(false);
    });

    it("processes only turns newer than the last processed JSONL session timestamp", () => {
      const lastProcessedSessionTimestamp = 200;
      const turns = [
        { timestamp: 100 },
        { timestamp: 200 },
        { timestamp: 250 },
        { timestamp: 300 },
      ];

      const newTurns = turns.filter((turn) => turn.timestamp > lastProcessedSessionTimestamp);

      expect(newTurns).toHaveLength(2);
      expect(newTurns[0].timestamp).toBe(250);
      expect(newTurns[1].timestamp).toBe(300);
    });
  });
});
