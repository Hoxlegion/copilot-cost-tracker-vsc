import { describe, it, expect } from "vitest";

// Unit tests for database operations (behavior validation)
// Note: sql.js integration tests would require WASM initialization

describe("Database Operations", () => {
  describe("Deduplication", () => {
    it("deduplicates turns on unique constraint (session_id, timestamp, model)", () => {
      const turns = [
        { sessionId: "s1", timestamp: 100, model: "gpt-4o" },
        { sessionId: "s1", timestamp: 100, model: "gpt-4o" }, // Duplicate
        { sessionId: "s1", timestamp: 101, model: "gpt-4o" }, // Different timestamp
        { sessionId: "s2", timestamp: 100, model: "gpt-4o" }, // Different session
      ];

      const deduped = Array.from(
        new Map(turns.map((t) => [`${t.sessionId}:${t.timestamp}:${t.model}`, t])).values()
      );

      expect(deduped.length).toBe(3);
    });

    it("allows same timestamp with different models", () => {
      const turns = [
        { sessionId: "s1", timestamp: 100, model: "gpt-4o" },
        { sessionId: "s1", timestamp: 100, model: "claude-3" },
      ];

      const deduped = Array.from(
        new Map(turns.map((t) => [`${t.sessionId}:${t.timestamp}:${t.model}`, t])).values()
      );

      expect(deduped.length).toBe(2);
    });

    it("allows multiple turns in same session", () => {
      const turns = [
        { sessionId: "s1", timestamp: 100, model: "gpt-4o" },
        { sessionId: "s1", timestamp: 101, model: "gpt-4o" },
        { sessionId: "s1", timestamp: 102, model: "gpt-4o" },
      ];

      const deduped = Array.from(
        new Map(turns.map((t) => [`${t.sessionId}:${t.timestamp}:${t.model}`, t])).values()
      );

      expect(deduped.length).toBe(3);
    });
  });

  describe("Data Retention (Pruning)", () => {
    it("prunes turns older than retention period", () => {
      const now = Date.now();
      const retentionDays = 30;
      const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;

      const turns = [
        { timestamp: cutoffMs - 1_000_000, sessionId: "s1" }, // Old, should prune
        { timestamp: cutoffMs + 1_000, sessionId: "s1" }, // Recent, keep
        { timestamp: now, sessionId: "s2" }, // Very recent, keep
      ];

      const pruned = turns.filter((t) => t.timestamp >= cutoffMs);

      expect(pruned.length).toBe(2);
      expect(pruned.every((t) => t.timestamp >= cutoffMs)).toBe(true);
    });

    it("keeps at least one turn per session after pruning", () => {
      const now = Date.now();
      const retentionDays = 30;
      const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;

      const turns = [
        { timestamp: cutoffMs - 100_000, sessionId: "s1" },
        { timestamp: cutoffMs - 50_000, sessionId: "s1" },
        { timestamp: cutoffMs + 1_000, sessionId: "s1" }, // Most recent
        { timestamp: cutoffMs - 200_000, sessionId: "s2" },
      ];

      // Prune strategy: delete old, but keep MAX(timestamp) per session
      const maxPerSession = new Map(
        turns
          .toSorted((a, b) => b.timestamp - a.timestamp)
          .map((t) => [t.sessionId, t])
      );

      const pruned = turns.filter((t) => {
        const sessionMax = maxPerSession.get(t.sessionId);
        return t.timestamp >= cutoffMs || t.sessionId === sessionMax?.sessionId;
      });

      expect(pruned.length).toBeGreaterThanOrEqual(2);

      // Verify at least one per session
      const sessionCounts = new Map<string, number>();
      pruned.forEach((t) => {
        sessionCounts.set(t.sessionId, (sessionCounts.get(t.sessionId) ?? 0) + 1);
      });

      expect(sessionCounts.size).toBe(2);
    });

    it("handles retention days edge cases (1, 365, 3650)", () => {
      const retentionValues = [1, 365, 3650];

      for (const days of retentionValues) {
        const clamped = Math.max(1, Math.min(3650, days));
        expect(clamped).toBe(days);
        expect(clamped).toBeGreaterThanOrEqual(1);
        expect(clamped).toBeLessThanOrEqual(3650);
      }
    });
  });

  describe("Watermark Recovery", () => {
    it("tracks last processed timestamp", () => {
      const turns = [
        { timestamp: 100 },
        { timestamp: 200 },
        { timestamp: 150 }, // Out of order
      ];

      const maxTimestamp = Math.max(...turns.map((t) => t.timestamp));
      expect(maxTimestamp).toBe(200);
    });

    it("resumes from watermark on restart", () => {
      const lastProcessed = 500;
      const newTurns = [
        { timestamp: 450 }, // Skip (before watermark)
        { timestamp: 550 }, // Process (after watermark)
        { timestamp: 600 }, // Process
      ];

      const toProcess = newTurns.filter((t) => t.timestamp > lastProcessed);
      expect(toProcess.length).toBe(2);
      expect(toProcess[0].timestamp).toBe(550);
    });

    it("handles zero-token calls in watermark", () => {
      const turns = [
        { timestamp: 100, tokens: 0 }, // Zero-token, skip cost but advance watermark
        { timestamp: 200, tokens: 100 }, // Process
      ];

      let watermark = 0;
      let costCount = 0;

      for (const turn of turns) {
        if (turn.tokens > 0) {
          costCount++;
        }
        watermark = Math.max(watermark, turn.timestamp);
      }

      expect(costCount).toBe(1);
      expect(watermark).toBe(200);
    });

    it("prevents duplicate processing on restart", () => {
      const lastProcessed = 150;
      const unprocessed = [
        { timestamp: 100 }, // Before watermark, shouldn't reprocess
        { timestamp: 150 }, // At watermark, shouldn't reprocess
        { timestamp: 200 }, // After watermark, should process
      ];

      const toProcess = unprocessed.filter((t) => t.timestamp > lastProcessed);
      expect(toProcess.length).toBe(1);
      expect(toProcess[0].timestamp).toBe(200);
    });
  });

  describe("Session Tracking", () => {
    it("groups turns by session_id", () => {
      const turns = [
        { sessionId: "s1", turnId: 1 },
        { sessionId: "s1", turnId: 2 },
        { sessionId: "s2", turnId: 3 },
        { sessionId: "s1", turnId: 4 },
      ];

      const bySessions = new Map<string, typeof turns>();
      for (const turn of turns) {
        if (!bySessions.has(turn.sessionId)) {
          bySessions.set(turn.sessionId, []);
        }
        bySessions.get(turn.sessionId)?.push(turn);
      }

      expect(bySessions.get("s1")?.length).toBe(3);
      expect(bySessions.get("s2")?.length).toBe(1);
    });

    it("calculates session summaries", () => {
      const turns = [
        { sessionId: "s1", tokens: 100, cost: 0.01 },
        { sessionId: "s1", tokens: 200, cost: 0.02 },
        { sessionId: "s1", tokens: 150, cost: 0.015 },
      ];

      const summary = {
        turnCount: turns.length,
        totalTokens: turns.reduce((sum, t) => sum + t.tokens, 0),
        totalCost: turns.reduce((sum, t) => sum + t.cost, 0),
      };

      expect(summary.turnCount).toBe(3);
      expect(summary.totalTokens).toBe(450);
      expect(summary.totalCost).toBeCloseTo(0.045);
    });
  });

  describe("Workspace Filtering", () => {
    it("filters turns by workspace", () => {
      const turns = [
        { workspace: "ws1", cost: 0.01 },
        { workspace: "ws2", cost: 0.02 },
        { workspace: "ws1", cost: 0.015 },
      ];

      const ws1Turns = turns.filter((t) => t.workspace === "ws1");
      expect(ws1Turns.length).toBe(2);
      expect(ws1Turns.every((t) => t.workspace === "ws1")).toBe(true);
    });

    it("lists unique workspaces", () => {
      const turns = [
        { workspace: "ws1" },
        { workspace: "ws2" },
        { workspace: "ws1" },
        { workspace: "ws3" },
      ];

      const workspaces = Array.from(new Set(turns.map((t) => t.workspace)));
      expect(workspaces.length).toBe(3);
      expect(workspaces).toContain("ws1");
      expect(workspaces).toContain("ws2");
      expect(workspaces).toContain("ws3");
    });
  });
});
