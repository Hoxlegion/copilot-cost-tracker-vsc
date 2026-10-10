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

  it("imports delegated JSONL calls and recorded credits while keeping parent session metadata", async () => {
    const sessionDir = join(userDataDir, "workspaceStorage", "repo-id", "GitHub.copilot-chat", "debug-logs", "parent-session");
    await mkdir(sessionDir, { recursive: true });
    const entry = (timestamp: number, type: string, spanId: string, sid: string, attrs: Record<string, unknown>) => ({
      v: 1, ts: timestamp, dur: 10, sid, type, name: type, spanId, status: "ok", attrs,
    });
    await writeFile(join(sessionDir, "main.jsonl"), [
      entry(100, "session_start", "start", "parent-session", { copilotVersion: "parent-version", vscodeVersion: "1.85" }),
      entry(300, "llm_request", "parent-call", "parent-session", {
        model: "gpt-5", inputTokens: 120, outputTokens: 40, cachedTokens: 100, copilotUsageNanoAiu: "2000000000",
      }),
    ].map(row => JSON.stringify(row)).join("\n"));
    await writeFile(join(sessionDir, "runSubagent-Explore-child.jsonl"), [
      entry(150, "session_start", "child-start", "child-session", { parentSessionId: "parent-session" }),
      entry(200, "llm_request", "child-call", "child-session", {
        model: "claude-haiku-4.5", inputTokens: 100, cachedTokens: 50, outputTokens: 5, copilotUsageNanoAiu: 3000000000,
      }),
    ].map(row => JSON.stringify(row)).join("\n"));
    await writeFile(join(sessionDir, "title-child.jsonl"), [
      entry(400, "llm_request", "title-call", "title-session", {
        model: "gpt-5-mini", inputTokens: 10, outputTokens: 1, copilotUsageNanoAiu: 0,
      }),
    ].map(row => JSON.stringify(row)).join("\n"));

    const session = await new LogParser().parseSession(sessionDir);

    expect(session).toMatchObject({
      sessionId: "parent-session", startTimestamp: 100, lastActivity: 400,
      copilotVersion: "parent-version", vscodeVersion: "1.85",
    });
    expect(session?.turns).toMatchObject([
      { sessionId: "parent-session", spanId: "child-call", timestamp: 200, inputTokens: 50, realCredits: 3 },
      { sessionId: "parent-session", spanId: "parent-call", timestamp: 300, realCredits: 2 },
      { sessionId: "parent-session", spanId: "title-call", timestamp: 400, realCredits: 0 },
    ]);
  });
});