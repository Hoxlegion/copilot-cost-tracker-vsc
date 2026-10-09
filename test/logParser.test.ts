import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogParser } from "../src/parser/logParser";
import { setUserDataPathOverride } from "../src/shared/paths";

describe("JSONL session streaming", () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "cost-jsonl-"));
    setUserDataPathOverride(userDataDir);
  });

  afterEach(async () => {
    setUserDataPathOverride(undefined);
    await rm(userDataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parses streamed CRLF entries, skips malformed lines, and keeps the latest session start", async () => {
    const sessionDir = join(userDataDir, "workspaceStorage", "repo-id", "GitHub.copilot-chat", "debug-logs", "session-1");
    await mkdir(sessionDir, { recursive: true });
    const entry = (timestamp: number, type: string, name: string, attrs: Record<string, unknown> = {}) => ({
      v: 1, ts: timestamp, dur: 10, sid: "session-1", type, name, spanId: String(timestamp), status: "ok", attrs,
    });
    await writeFile(join(sessionDir, "main.jsonl"), [
      JSON.stringify(entry(100, "session_start", "start", { copilotVersion: "old", vscodeVersion: "old" })),
      "{invalid json",
      "  ",
      JSON.stringify(entry(200, "LLM_request", "call", {
        model: "gpt-5", inputTokens: 120, outputTokens: 40, cachedTokens: 100,
      })),
      JSON.stringify(entry(300, "session_start", "start", { copilotVersion: "new", vscodeVersion: "1.85" })),
      JSON.stringify(entry(400, "trace", "llm_request", { model: "gpt-5-mini", input_tokens: 15 })),
      JSON.stringify(entry(500, "trace", "other")),
    ].join("\r\n"), "utf8");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sessions = await new LogParser().parseAllSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "session-1", workspace: "repo-id", startTimestamp: 300, lastActivity: 500,
      copilotVersion: "new", vscodeVersion: "1.85",
    });
    expect(sessions[0].turns).toMatchObject([
      { timestamp: 200, model: "gpt-5", inputTokens: 20, outputTokens: 40, cachedTokens: 100 },
      { timestamp: 400, model: "gpt-5-mini", inputTokens: 15 },
    ]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Skipped 1 malformed line"));
  });
});