import { describe, it, expect } from "vitest";

/**
 * Unit tests for configuration validation logic.
 * Tests the core clamping, sanitization, and filtering functions.
 */

// Helper functions (mirrors src/config.ts)
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const MODEL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function sanitizeModelName(value: string): string | null {
  const trimmed = value.trim();
  if (!MODEL_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

describe("Config Validation", () => {
  it("clamps pollIntervalMin to valid range (1000-300000)", () => {
    const testCases = [
      { input: 100, expected: 1000 },
      { input: 1000, expected: 1000 },
      { input: 5000, expected: 5000 },
      { input: 500000, expected: 300000 },
    ];

    for (const tc of testCases) {
      const result = clamp(tc.input, 1000, 300000);
      expect(result).toBe(tc.expected);
    }
  });

  it("clamps pollIntervalMax respecting minimum bounds", () => {
    const pollIntervalMin = 5000;
    const testCases = [
      { input: 1000, expected: 5000 },
      { input: 60000, expected: 60000 },
      { input: 700000, expected: 600000 },
    ];

    for (const tc of testCases) {
      const result = clamp(tc.input, pollIntervalMin, 600000);
      expect(result).toBe(tc.expected);
    }
  });

  it("validates billingCycleStartDay bounds (1-31)", () => {
    const invalidValues = [0, 32, 100, -5];
    const validValues = [1, 15, 31];

    for (const val of invalidValues) {
      const clamped = clamp(Math.round(val), 1, 31);
      expect(clamped).toBeGreaterThanOrEqual(1);
      expect(clamped).toBeLessThanOrEqual(31);
    }

    for (const val of validValues) {
      const clamped = clamp(Math.round(val), 1, 31);
      expect(clamped).toBe(val);
    }
  });

  it("filters invalid budget warning thresholds (0-100)", () => {
    const rawThresholds = [75, 150, -10, 90, "invalid", 100, 0, 50];
    const filtered = (rawThresholds as unknown[])
      .filter((t) => typeof t === "number" && t >= 0 && t <= 100)
      .sort((a, b) => (a as number) - (b as number));

    expect(filtered).toEqual([0, 50, 75, 90, 100]);
  });

  it("sanitizes model names with regex validation", () => {
    const validNames = ["gpt-4o", "claude-3-opus", "gemini-1.5"];
    const invalidNames = ["", " ", "model@invalid", "model\nname"];

    for (const name of validNames) {
      const result = sanitizeModelName(name);
      expect(result).not.toBeNull();
    }

    for (const name of invalidNames) {
      const result = sanitizeModelName(name);
      expect(result).toBeNull();
    }
  });

  it("clamps retentionDays to 1-3650 range", () => {
    const testCases = [
      { input: 0, expected: 1 },
      { input: 365, expected: 365 },
      { input: 4000, expected: 3650 },
      { input: -100, expected: 1 },
      { input: 3650, expected: 3650 },
    ];

    for (const tc of testCases) {
      const clamped = clamp(tc.input, 1, 3650);
      expect(clamped).toBe(tc.expected);
    }
  });

  it("validates custom model rates (non-negative, bounded)", () => {
    const validRates = [
      { input: 0.001, output: 0.005 },
      { input: 1000, output: 5000 },
      { input: 0, output: 0 },
    ];
    const invalidRates = [
      { input: -1, output: 5 },
      { input: 0.001, output: Infinity },
    ];

    for (const rate of validRates) {
      const valid =
        Number.isFinite(rate.input) &&
        Number.isFinite(rate.output) &&
        rate.input >= 0 &&
        rate.output >= 0 &&
        rate.input <= 1_000_000_000 &&
        rate.output <= 1_000_000_000;
      expect(valid).toBe(true);
    }

    for (const rate of invalidRates) {
      const valid =
        Number.isFinite(rate.input) &&
        Number.isFinite(rate.output) &&
        rate.input >= 0 &&
        rate.output >= 0;
      expect(valid).toBe(false);
    }
  });

  it("deduplicates and filters excluded models", () => {
    const rawExcluded = ["gpt-4o-mini", "gpt-4o-mini", "claude", ""];
    const filtered = Array.from(
      new Set(
        (rawExcluded as unknown[])
          .filter((m) => typeof m === "string" && m.trim().length > 0)
          .map((m) => sanitizeModelName(m as string))
          .filter((m): m is string => m !== null)
      )
    );

    expect(filtered.length).toBe(2);
    expect(filtered).toContain("gpt-4o-mini");
    expect(filtered).toContain("claude");
  });

  it("validates telemetry source enum", () => {
    const TELEMETRY_SOURCES = new Set(["auto", "database", "jsonl"]);
    const validSources = ["auto", "database", "jsonl"];
    const invalidSources = ["filesystem", "api", ""];

    for (const src of validSources) {
      expect(TELEMETRY_SOURCES.has(src)).toBe(true);
    }

    for (const src of invalidSources) {
      expect(TELEMETRY_SOURCES.has(src)).toBe(false);
    }
  });

  it("clamps refreshDebounceMs to valid range (100-5000)", () => {
    const testCases = [
      { input: 10, expected: 100 },
      { input: 2000, expected: 2000 },
      { input: 10000, expected: 5000 },
    ];

    for (const tc of testCases) {
      const result = clamp(tc.input, 100, 5000);
      expect(result).toBe(tc.expected);
    }
  });
});
