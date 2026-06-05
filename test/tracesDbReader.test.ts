import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExec = vi.fn();
const mockPrepare = vi.fn();
const mockClose = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("node:os", () => ({
  homedir: () => "C:/Users/test",
  platform: () => "win32",
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock("sql.js", () => ({
  default: vi.fn(async () => ({
    Database: class MockDatabase {
      exec(...args: unknown[]) {
        return mockExec(...args);
      }

      prepare(...args: unknown[]) {
        return mockPrepare(...args);
      }

      close(...args: unknown[]) {
        return mockClose(...args);
      }
    },
  })),
}));

import { TracesDbReader } from "../src/parser/tracesDbReader";

describe("TracesDbReader", () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockPrepare.mockReset();
    mockClose.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(Buffer.from("db"));
  });

  it("reads spans from DB and defaults cacheWriteTokens to 0 (column removed from schema)", async () => {
    mockExec.mockReturnValue([
      {
        values: [
          [0, "span_id"],
          [1, "cache_write_tokens"],
        ],
      },
    ]);

    const statement = {
      bind: vi.fn(),
      step: vi.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false),
      getAsObject: vi.fn(() => ({
        span_id: "span-1",
        trace_id: "trace-1",
        parent_span_id: null,
        name: "llm_call",
        start_time_ms: 1000,
        end_time_ms: 1200,
        status_code: 0,
        operation_name: null,
        provider_name: "anthropic",
        agent_name: "GitHub Copilot Chat",
        conversation_id: "conv-1",
        request_model: "claude-sonnet-4.6",
        response_model: "claude-sonnet-4.6",
        input_tokens: 100,
        output_tokens: 50,
        cached_tokens: 25,
        reasoning_tokens: 0,
        tool_name: null,
        chat_session_id: "session-1",
        turn_index: 1,
        ttft_ms: 42,
      })),
      free: vi.fn(),
    };

    mockPrepare.mockReturnValue(statement);

    const reader = new TracesDbReader();
    const spans = await reader.querySpans();

    expect(mockPrepare).not.toHaveBeenCalledWith(expect.stringContaining("cache_write_tokens"));
    expect(spans).toHaveLength(1);
    expect(spans[0].cacheWriteTokens).toBe(0); // always 0 since column was removed
    expect(spans[0].cachedTokens).toBe(25);
    expect(spans[0].inputTokens).toBe(100);
  });
});