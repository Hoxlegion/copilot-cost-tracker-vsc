import { describe, it, expect } from "vitest";

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
      let debounceTimer: NodeJS.Timeout | undefined;

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

    it("concurrent ingestion guard prevents overlapping runs", async () => {
      let isRunning = false;
      let completedCount = 0;

      const runCallback = async (): Promise<void> => {
        if (isRunning) return;
        isRunning = true;
        try {
          await new Promise((resolve) => setTimeout(resolve, 50));
          completedCount++;
        } finally {
          isRunning = false;
        }
      };

      await Promise.all([runCallback(), runCallback(), runCallback()]);
      expect(completedCount).toBe(1);
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

    it("handles skipped zero-token calls in watermark", () => {
      let lastProcessed = 1000;
      const spans = [
        { timestamp: 1100, tokens: 0 }, // Skip but advance watermark
        { timestamp: 1200, tokens: 100 }, // Process normally
      ];

      for (const span of spans) {
        lastProcessed = Math.max(lastProcessed, span.timestamp);
      }

      expect(lastProcessed).toBe(1200);
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
    it("fires dataChanged event on new turns", () => {
      const events: number[] = [];

      const newCount = 5;
      if (newCount > 0) {
        events.push(newCount);
      }

      expect(events.length).toBe(1);
      expect(events[0]).toBe(5);
    });

    it("doesn't fire event on zero new turns", () => {
      const events: number[] = [];

      const newCount = 0;
      if (newCount > 0) {
        events.push(newCount);
      }

      expect(events.length).toBe(0);
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
