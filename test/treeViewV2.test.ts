import { describe, it, expect } from "vitest";
import { formatDuration, simplifyModelName } from "../src/views/treeViewFormatting";

describe("treeViewV2 helpers", () => {
  it("rounds sub-second durations in milliseconds", () => {
    expect(formatDuration(540.4)).toBe("540 ms");
    expect(formatDuration(540.9)).toBe("541 ms");
  });

  it("formats durations >= 1000ms in seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(5409.96533203125)).toBe("5.4s");
  });

  it("simplifies datestamped model suffixes", () => {
    expect(simplifyModelName("gpt-4o-mini-2024-07-18")).toBe("gpt-4o-mini");
    expect(simplifyModelName("claude-sonnet-4.6")).toBe("claude-sonnet-4.6");
  });
});
