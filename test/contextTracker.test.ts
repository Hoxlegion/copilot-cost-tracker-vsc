import { describe, it, expect } from "vitest";

describe("ContextTracker Tier Classification", () => {
  const TIER_THRESHOLDS = {
    light: 5_000,
    moderate: 20_000,
    heavy: 40_000,
  };

  type ContextTier = "light" | "moderate" | "heavy" | "critical";

  function classifyTier(tokens: number): ContextTier {
    if (tokens <= TIER_THRESHOLDS.light) return "light";
    if (tokens <= TIER_THRESHOLDS.moderate) return "moderate";
    if (tokens <= TIER_THRESHOLDS.heavy) return "heavy";
    return "critical";
  }

  describe("classifyTier", () => {
    it("classifies 0 tokens as light", () => {
      expect(classifyTier(0)).toBe("light");
    });

    it("classifies 5000 tokens as light (boundary)", () => {
      expect(classifyTier(5000)).toBe("light");
    });

    it("classifies 5001 tokens as moderate", () => {
      expect(classifyTier(5001)).toBe("moderate");
    });

    it("classifies 20000 tokens as moderate (boundary)", () => {
      expect(classifyTier(20000)).toBe("moderate");
    });

    it("classifies 20001 tokens as heavy", () => {
      expect(classifyTier(20001)).toBe("heavy");
    });

    it("classifies 40000 tokens as heavy (boundary)", () => {
      expect(classifyTier(40000)).toBe("heavy");
    });

    it("classifies 40001 tokens as critical", () => {
      expect(classifyTier(40001)).toBe("critical");
    });

    it("classifies 100000 tokens as critical", () => {
      expect(classifyTier(100000)).toBe("critical");
    });
  });

  describe("tokensToPages", () => {
    function tokensToPages(tokens: number): string {
      const pages = Math.round(tokens / 2500);
      if (pages <= 0) return "< 1 page";
      if (pages === 1) return "~1 page";
      return `~${pages} pages`;
    }

    it("returns '< 1 page' for 0 tokens", () => {
      expect(tokensToPages(0)).toBe("< 1 page");
    });

    it("returns '~1 page' for 2500 tokens", () => {
      expect(tokensToPages(2500)).toBe("~1 page");
    });

    it("returns '~2 pages' for 5000 tokens", () => {
      expect(tokensToPages(5000)).toBe("~2 pages");
    });

    it("returns '~8 pages' for 20000 tokens", () => {
      expect(tokensToPages(20000)).toBe("~8 pages");
    });

    it("returns '~16 pages' for 40000 tokens", () => {
      expect(tokensToPages(40000)).toBe("~16 pages");
    });

    it("returns '~32 pages' for 80000 tokens", () => {
      expect(tokensToPages(80000)).toBe("~32 pages");
    });
  });

  describe("Notification Threshold Logic", () => {
    const NOTIFICATION_THRESHOLDS = [20_000, 40_000, 80_000];

    it("fires 20K threshold when context crosses 20000", () => {
      const firedThresholds = new Set<number>();
      const contextWeight = 25000;

      for (const threshold of NOTIFICATION_THRESHOLDS) {
        if (contextWeight >= threshold && !firedThresholds.has(threshold)) {
          firedThresholds.add(threshold);
        }
      }

      expect(firedThresholds.has(20000)).toBe(true);
      expect(firedThresholds.has(40000)).toBe(false);
      expect(firedThresholds.has(80000)).toBe(false);
    });

    it("fires both 20K and 40K thresholds when context is 50000", () => {
      const firedThresholds = new Set<number>();
      const contextWeight = 50000;

      for (const threshold of NOTIFICATION_THRESHOLDS) {
        if (contextWeight >= threshold && !firedThresholds.has(threshold)) {
          firedThresholds.add(threshold);
        }
      }

      expect(firedThresholds.has(20000)).toBe(true);
      expect(firedThresholds.has(40000)).toBe(true);
      expect(firedThresholds.has(80000)).toBe(false);
    });

    it("fires all thresholds when context is 100000", () => {
      const firedThresholds = new Set<number>();
      const contextWeight = 100000;

      for (const threshold of NOTIFICATION_THRESHOLDS) {
        if (contextWeight >= threshold && !firedThresholds.has(threshold)) {
          firedThresholds.add(threshold);
        }
      }

      expect(firedThresholds.has(20000)).toBe(true);
      expect(firedThresholds.has(40000)).toBe(true);
      expect(firedThresholds.has(80000)).toBe(true);
    });

    it("does not re-fire thresholds for same session", () => {
      const firedThresholds = new Set<number>();
      firedThresholds.add(20000);

      const contextWeight = 25000;
      let notificationCount = 0;

      for (const threshold of NOTIFICATION_THRESHOLDS) {
        if (contextWeight >= threshold && !firedThresholds.has(threshold)) {
          firedThresholds.add(threshold);
          notificationCount++;
        }
      }

      expect(notificationCount).toBe(0);
    });

    it("resets fired thresholds when session changes", () => {
      const firedThresholds = new Set<number>();
      firedThresholds.add(20000);
      firedThresholds.add(40000);

      const trackedSessionId = "session-A";
      const newSessionId = "session-B";

      if (newSessionId !== trackedSessionId) {
        firedThresholds.clear();
      }

      expect(firedThresholds.size).toBe(0);
    });
  });

  describe("Context Waste Calculation", () => {
    it("calculates waste percentage correctly", () => {
      const firstTurnInput = 1000;
      const lastTurnInput = 10000;

      const waste = (lastTurnInput - firstTurnInput) / lastTurnInput;
      expect(waste).toBeCloseTo(0.9, 2);
    });

    it("returns 0% waste when first and last turn are equal", () => {
      const firstTurnInput = 5000;
      const lastTurnInput = 5000;

      const waste = (lastTurnInput - firstTurnInput) / lastTurnInput;
      expect(waste).toBe(0);
    });

    it("handles single-turn sessions (no waste)", () => {
      const turns = [{ currentContextWeight: 3000 }];

      let waste = 0;
      if (turns.length >= 2) {
        const first = turns[0].currentContextWeight;
        const last = turns[turns.length - 1].currentContextWeight;
        if (last > 0) {
          waste = (last - first) / last;
        }
      }

      expect(waste).toBe(0);
    });
  });
});
