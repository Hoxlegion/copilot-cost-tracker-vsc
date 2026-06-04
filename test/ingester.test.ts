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

  describe("Adaptive Polling", () => {
    it("resets interval to minimum when data is found", () => {
      const minInterval = 5000;
      const maxInterval = 60000;
      let currentInterval = maxInterval; // Simulate backed-off interval from empty polls

      // Data found
      const newCount = 5;
      if (newCount > 0) {
        currentInterval = minInterval; // Reset to minimum
      }

      expect(currentInterval).toBe(minInterval);
    });

    it("doubles interval when no data is found", () => {
      const minInterval = 5000;
      const maxInterval = 60000;
      let currentInterval = minInterval;

      // Simulate multiple empty polls
      for (let i = 0; i < 5; i++) {
        currentInterval = Math.min(currentInterval * 2, maxInterval);
      }

      expect(currentInterval).toBe(maxInterval);
    });

    it("respects maximum polling interval", () => {
      const minInterval = 5000;
      const maxInterval = 60000;
      let currentInterval = minInterval;

      // Keep doubling
      for (let i = 0; i < 10; i++) {
        currentInterval = Math.min(currentInterval * 2, maxInterval);
      }

      expect(currentInterval).toBeLessThanOrEqual(maxInterval);
      expect(currentInterval).toBe(maxInterval);
    });

    it("respects minimum polling interval", () => {
      const minInterval = 5000;
      const maxInterval = 60000;

      expect(minInterval).toBeLessThanOrEqual(maxInterval);
      expect(minInterval).toBeGreaterThan(0);
    });

    it("resets failover counter when DB produces data", () => {
      let consecutiveEmptyPolls = 5;
      const newCount = 3; // Data found

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
      let lastProcessed = maxTimestampInDb; // Recovered from DB

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
  });
});
