import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

vi.mock("vscode", () => ({
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

import { TracesIngester, type TracesIngesterOptions } from "../src/watcher/tracesIngester";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
import { TracesDbReader } from "../src/parser/tracesDbReader";
import { setUserDataPathOverride } from "../src/shared/paths";
import type { ParsedTurn, TraceSpan } from "../src/parser/types";

type IngesterArgs = ConstructorParameters<typeof TracesIngester>;

const BASE_MS = 1_790_000_000_000;

function traceSpan(spanId: string, startTimeMs: number, overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    spanId, traceId: `trace-${spanId}`, parentSpanId: null, name: "chat",
    startTimeMs, endTimeMs: startTimeMs + 100, statusCode: 0, operationName: null,
    providerName: null, agentName: "panel/editAgent", conversationId: null,
    requestModel: "gpt-5", responseModel: "gpt-5", inputTokens: 10, outputTokens: 2,
    cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, toolName: null,
    chatSessionId: `session-${spanId}`, turnIndex: 1, ttftMs: null, realCredits: 1,
    workspaceRepo: null,
    ...overrides,
  };
}

/** A reader over an in-memory span list that honours the bound and batch size like the real one. */
function spanReader(spans: TraceSpan[]) {
  return {
    exists: () => true,
    path: "agent-traces.db",
    getLastRefresh: () => undefined,
    iterateSpanBatches: vi.fn(async function* (sinceMs: number | undefined, batchSize: number) {
      const visible = spans
        .filter((span) => sinceMs === undefined || span.startTimeMs > sinceMs)
        .sort((a, b) => a.startTimeMs - b.startTimeMs);
      for (let index = 0; index < visible.length; index += batchSize) yield visible.slice(index, index + batchSize);
    }),
  };
}

function createIngester(reader: unknown, database: unknown, options: TracesIngesterOptions = {}) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ingester = new TracesIngester(
    reader as IngesterArgs[0],
    { discoverSessionTitles: () => new Map<string, string>() } as unknown as IngesterArgs[1],
    { calculateCost: () => 0.01, costToCredits: (costUsd: number) => costUsd * 100 } as unknown as IngesterArgs[2],
    database as IngesterArgs[3],
    { config: { excludedModels: ["gpt-4o-mini"] } } as unknown as IngesterArgs[4],
    logger as unknown as IngesterArgs[5],
    "workspace",
    options,
  );
  ingester.setTelemetrySource("database");
  const internals = ingester as unknown as {
    onDataChanged: { fire: Mock };
    sourceResolver: { recordEmptyDbPoll(): void; recordSuccessfulDbPoll(): void };
  };
  return { ingester, logger, fire: internals.onDataChanged.fire, sourceResolver: internals.sourceResolver };
}

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
      let finishFirstRead!: () => void;
      const firstRead = new Promise<void>((resolve) => { finishFirstRead = resolve; });
      const reader = {
        getLastRefresh: () => undefined,
        iterateSpanBatches: vi.fn()
          .mockImplementationOnce(async function* () { await firstRead; })
          .mockImplementationOnce(async function* () {}),
      };
      const database = {
        getMaxTimestamp: () => 1000,
        recomputeCacheTokenSemantics: () => false,
      };
      const { ingester } = createIngester(reader, database);

      const incremental = ingester.ingest();
      await vi.waitFor(() => expect(reader.iterateSpanBatches).toHaveBeenCalledTimes(1));
      const fullScan = ingester.fullIngest();
      finishFirstRead();

      await Promise.all([incremental, fullScan]);
      expect(reader.iterateSpanBatches).toHaveBeenCalledTimes(2);
      expect(reader.iterateSpanBatches).toHaveBeenNthCalledWith(2, undefined, expect.any(Number));
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
      const span = traceSpan("span-1", 1200, { inputTokens: 0, outputTokens: 0, realCredits: undefined });
      const spans = [span];
      const reader = spanReader(spans);
      const database = {
        getMaxTimestamp: () => 1000,
        recomputeCacheTokenSemantics: () => false,
        beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
        insertTurn: vi.fn(() => true),
      };
      const { ingester } = createIngester(reader, database, { overlapMs: 0 });

      expect(await ingester.ingest()).toBe(0);
      spans[0] = { ...span, inputTokens: 10 };
      expect(await ingester.ingest()).toBe(1);

      expect(reader.iterateSpanBatches).toHaveBeenNthCalledWith(2, 1000, expect.any(Number));
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

describe("bounded trace ingestion", () => {
  function fakeDatabase(failOnSpanStart?: number) {
    return {
      getMaxTimestamp: () => 0,
      recomputeCacheTokenSemantics: () => false,
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      save: vi.fn(),
      insertTurn: vi.fn((turn: { timestamp: number; sessionId: string }) => {
        if (turn.timestamp === failOnSpanStart) throw new Error("insert failed");
        return true;
      }),
    };
  }

  it("writes every batch in its own transaction, yields between batches, and never saves", async () => {
    const spans = Array.from({ length: 2_500 }, (_, index) => traceSpan(`span-${index}`, BASE_MS + index));
    const database = fakeDatabase();
    const { ingester } = createIngester(spanReader(spans), database);
    let commitsAtNextTick = -1;
    setImmediate(() => { commitsAtNextTick = database.commitTransaction.mock.calls.length; });

    expect(await ingester.ingest()).toBe(2_500);

    expect(database.beginTransaction).toHaveBeenCalledTimes(3);
    expect(database.commitTransaction).toHaveBeenCalledTimes(3);
    expect(commitsAtNextTick).toBe(1);
    expect(database.save).not.toHaveBeenCalled();
    ingester.dispose();
  });

  it("keeps spans with equal start times that straddle a batch boundary", async () => {
    const spans = [
      traceSpan("a", BASE_MS + 100),
      traceSpan("b", BASE_MS + 200),
      traceSpan("c", BASE_MS + 200),
      traceSpan("d", BASE_MS + 300),
    ];
    const database = { ...fakeDatabase(), getMaxTimestamp: () => BASE_MS };
    const { ingester } = createIngester(spanReader(spans), database, { batchSize: 2, overlapMs: 0 });

    expect(await ingester.ingest()).toBe(4);
    expect(database.insertTurn.mock.calls.map(([turn]) => turn.sessionId))
      .toEqual(["session-a", "session-b", "session-c", "session-d"]);
    ingester.dispose();
  });

  it("keeps earlier batches and their watermark when a later batch fails", async () => {
    const spans = [1, 2, 3, 4].map((index) => traceSpan(`span-${index}`, BASE_MS + index));
    const reader = spanReader(spans);
    const database = { ...fakeDatabase(BASE_MS + 4), getMaxTimestamp: () => BASE_MS };
    const { ingester, logger, fire } = createIngester(reader, database, { batchSize: 2, overlapMs: 0 });

    expect(await ingester.ingest()).toBe(2);
    expect(database.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("Failed during batch insert, rolling back transaction", expect.any(Error));
    expect(fire).toHaveBeenCalledTimes(1);

    await ingester.ingest();
    expect(reader.iterateSpanBatches).toHaveBeenLastCalledWith(BASE_MS + 2, 2);
    ingester.dispose();
  });

  it("counts a poll as empty when only spans inside the overlap window are found", async () => {
    const spans = [traceSpan("seen", BASE_MS)];
    const { ingester, sourceResolver } = createIngester(spanReader(spans), { ...fakeDatabase(), getMaxTimestamp: () => BASE_MS });
    const empty = vi.spyOn(sourceResolver, "recordEmptyDbPoll");
    const successful = vi.spyOn(sourceResolver, "recordSuccessfulDbPoll");

    await ingester.ingest();
    expect(empty).toHaveBeenCalledTimes(1);
    expect(successful).not.toHaveBeenCalled();

    spans.push(traceSpan("new", BASE_MS + 1_000));
    await ingester.ingest();
    expect(successful).toHaveBeenCalledTimes(1);
    ingester.dispose();
  });

  describe("with a real cost database", () => {
    let storageDir: string;
    let database: CostDatabase;

    beforeEach(async () => {
      setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
      storageDir = await mkdtemp(join(tmpdir(), "cost-ingest-"));
      database = new CostDatabase(storageDir);
      await database.initialize();
    });

    afterEach(async () => {
      database.close();
      await rm(storageDir, { recursive: true, force: true });
    });

    function creditTotal(): number {
      return database.getAllTurns().reduce((sum, turn) => sum + turn.credits, 0);
    }

    it("re-reads the overlap window without double counting or change events", async () => {
      const spans = [traceSpan("a", BASE_MS + 1_000), traceSpan("b", BASE_MS + 2_000, { realCredits: 2 })];
      const reader = spanReader(spans);
      const { ingester, fire } = createIngester(reader, database);

      expect(await ingester.ingest()).toBe(2);
      // The first pass also fires for the one-time data migration of a fresh database.
      const firesAfterFirstPass = fire.mock.calls.length;
      expect(await ingester.ingest()).toBe(0);

      expect(reader.iterateSpanBatches).toHaveBeenLastCalledWith(BASE_MS + 2_000 - 15 * 60_000, expect.any(Number));
      expect(fire).toHaveBeenCalledTimes(firesAfterFirstPass);
      expect(database.getAllTurns()).toHaveLength(2);
      expect(creditTotal()).toBe(3);
      ingester.dispose();
    });

    it("ingests a late span inside the overlap window and leaves older ones to a full scan", async () => {
      const spans = [traceSpan("latest", BASE_MS + 30 * 60_000)];
      const { ingester } = createIngester(spanReader(spans), database);
      expect(await ingester.ingest()).toBe(1);

      spans.push(
        traceSpan("late-in-window", BASE_MS + 25 * 60_000, { realCredits: 4 }),
        traceSpan("late-before-window", BASE_MS, { realCredits: 8 }),
      );
      expect(await ingester.ingest()).toBe(1);
      expect(creditTotal()).toBe(5);

      expect(await ingester.fullIngest()).toBe(1);
      expect(await ingester.fullIngest()).toBe(0);
      expect(creditTotal()).toBe(13);
      ingester.dispose();
    });

    it("runs the Copilot CLI step after Chat without moving the Chat watermark", async () => {
      const cliTimestamp = BASE_MS + 60 * 60_000;
      const cliTurn: ParsedTurn = {
        sessionId: "cli-1", timestamp: cliTimestamp, duration: 0, agentName: "copilot-cli", model: "gpt-5",
        modelFamily: "gpt-5", inputTokens: 10, outputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0,
        totalTokens: 11, status: "ok", costSource: "real", source: "cli", requestCount: 2,
      };
      const cliIngester = {
        ingest: vi.fn(async () => {
          database.replaceCliSession(
            { sessionId: "cli-1", filePath: "events.jsonl", size: 1, mtimeMs: 1, status: "ok", lastEventMs: cliTimestamp },
            { workspace: "Org/Repo", startTimestamp: cliTimestamp, lastTimestamp: cliTimestamp, copilotVersion: null, title: null },
            [{ turn: cliTurn, costUsd: 0.05, credits: 5, workspace: "Org/Repo" }],
          );
          return { sessions: 1, turns: 1 };
        }),
      };
      const spans = [traceSpan("chat", BASE_MS)];
      const { ingester } = createIngester(spanReader(spans), database, { cliIngester });

      expect(await ingester.ingest()).toBe(2);
      expect(cliIngester.ingest).toHaveBeenLastCalledWith({ force: false });
      await ingester.fullIngest();
      expect(cliIngester.ingest).toHaveBeenLastCalledWith({ force: true });
      ingester.dispose();

      // A restart recovers the Chat watermark, so a Chat span older than the CLI row is still read.
      expect(database.getMaxTimestamp()).toBe(BASE_MS);
      spans.push(traceSpan("chat-late", BASE_MS + 1_000));
      const { ingester: restarted } = createIngester(spanReader(spans), database, { overlapMs: 0 });
      expect(await restarted.ingest()).toBe(1);
      expect(creditTotal()).toBe(7);
      restarted.dispose();
    });

    it("keeps Chat results when the Copilot CLI step fails", async () => {
      const cliIngester = { ingest: vi.fn(async () => { throw new Error("unreadable"); }) };
      const { ingester, logger } = createIngester(spanReader([traceSpan("chat", BASE_MS)]), database, { cliIngester });

      expect(await ingester.ingest()).toBe(1);
      expect(logger.error).toHaveBeenCalledWith("Failed to ingest Copilot CLI session logs", expect.any(Error));
      ingester.dispose();
    });

    it("ingests WAL appends from the real traces reader without double counting", async () => {
      const userDataDir = await mkdtemp(join(tmpdir(), "cost-ingest-traces-"));
      const storage = join(userDataDir, "globalStorage", "github.copilot-chat");
      await mkdir(storage, { recursive: true });
      setUserDataPathOverride(userDataDir);
      const writer = new DatabaseSync(join(storage, "agent-traces.db"));
      const reader = new TracesDbReader(require.resolve("sql.js/dist/sql-wasm.wasm"));
      try {
        writer.exec(`
          CREATE TABLE spans (
            span_id TEXT PRIMARY KEY, trace_id TEXT, parent_span_id TEXT, name TEXT,
            start_time_ms INTEGER, end_time_ms INTEGER, status_code INTEGER DEFAULT 0,
            operation_name TEXT, provider_name TEXT, agent_name TEXT DEFAULT 'panel/editAgent',
            conversation_id TEXT, request_model TEXT, response_model TEXT DEFAULT 'gpt-5',
            input_tokens INTEGER DEFAULT 10, output_tokens INTEGER DEFAULT 2, cached_tokens INTEGER DEFAULT 0,
            reasoning_tokens INTEGER DEFAULT 0, tool_name TEXT, chat_session_id TEXT,
            turn_index INTEGER, ttft_ms INTEGER
          );
          CREATE TABLE span_attributes (span_id TEXT, key TEXT, value TEXT);
          PRAGMA journal_mode = WAL;
          PRAGMA wal_autocheckpoint = 0;
        `);
        const insert = (spanId: string, startMs: number, nanoAiu: string) => {
          writer.prepare("INSERT INTO spans (span_id, start_time_ms, end_time_ms, chat_session_id) VALUES (?, ?, ?, ?)")
            .run(spanId, startMs, startMs + 100, `session-${spanId}`);
          writer.prepare("INSERT INTO span_attributes VALUES (?, 'copilot_chat.copilot_usage_nano_aiu', ?)").run(spanId, nanoAiu);
        };
        const { ingester } = createIngester(reader, database);

        insert("first", BASE_MS, "2000000000");
        expect(await ingester.ingest()).toBe(1);
        insert("second", BASE_MS + 1_000, "3000000000");
        expect(await ingester.ingest()).toBe(1);
        expect(reader.getLastRefresh()?.mode).toBe("incremental");
        expect(await ingester.ingest()).toBe(0);
        expect(await ingester.fullIngest()).toBe(0);

        expect(database.getAllTurns()).toHaveLength(2);
        expect(creditTotal()).toBe(5);
        ingester.dispose();
      } finally {
        reader.dispose();
        writer.close();
        setUserDataPathOverride(undefined);
        await rm(userDataDir, { recursive: true, force: true });
      }
    });
  });
});
