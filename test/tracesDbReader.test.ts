import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExec = vi.fn();
const mockPrepare = vi.fn();
const mockClose = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockStatSync = vi.fn();
const mockOpenSync = vi.fn();
const mockFstatSync = vi.fn();
const mockCloseSync = vi.fn();
const mockPromisesOpen = vi.fn();
const mockPromisesStat = vi.fn();
const mockFhStat = vi.fn();
const mockFhRead = vi.fn();
const mockFhClose = vi.fn();
const mainBytes = Buffer.from([100, 98]);

async function readMain(buffer: Buffer, offset: number, length: number, position: number) {
  const bytesRead = Math.max(0, Math.min(length, mainBytes.length - position));
  mainBytes.copy(buffer, offset, position, position + bytesRead);
  return { bytesRead, buffer };
}

function prepareSpanRows(statement: object): void {
  mockPrepare.mockImplementation((sql: string) => sql.includes("FROM spans s")
    ? statement
    : { step: () => false, getAsObject: () => ({}), free: vi.fn(), bind: vi.fn() });
}

vi.mock("node:os", () => ({
  homedir: () => "C:/Users/test",
  platform: () => "win32",
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  fstatSync: (...args: unknown[]) => mockFstatSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  promises: {
    open: (...args: unknown[]) => mockPromisesOpen(...args),
    stat: (...args: unknown[]) => mockPromisesStat(...args),
  },
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

import { TracesDbReader, repoUrlToName } from "../src/parser/tracesDbReader";

describe("TracesDbReader", () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockPrepare.mockReset();
    mockClose.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockStatSync.mockReset();
    mockOpenSync.mockReset();
    mockFstatSync.mockReset();
    mockCloseSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(new Uint8Array([100, 98]));
    mockStatSync.mockReturnValue({ mtimeMs: 1, size: 2 });
    mockOpenSync.mockReturnValue(3);
    mockFstatSync.mockReturnValue({ mtimeMs: 1, size: 2 });
    mockCloseSync.mockReturnValue(undefined);
    mockFhStat.mockReset();
    mockFhRead.mockReset();
    mockFhClose.mockReset();
    mockPromisesOpen.mockReset();
    mockPromisesStat.mockReset();
    mockFhStat.mockResolvedValue({ mtimeMs: 1, size: 2 });
    mockFhRead.mockImplementation(readMain);
    mockFhClose.mockResolvedValue(undefined);
    mockPromisesOpen.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("-wal")) throw Object.assign(new Error("no WAL"), { code: "ENOENT" });
      return {
        stat: (...args: unknown[]) => mockFhStat(...args),
        read: (...args: unknown[]) => mockFhRead(...args),
        close: (...args: unknown[]) => mockFhClose(...args),
      };
    });
    mockPromisesStat.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("-wal")) throw Object.assign(new Error("no WAL"), { code: "ENOENT" });
      return { mtimeMs: 1, size: 2 };
    });
  });

  it("shares a single async file read across simultaneous queries", async () => {
    let completeRead!: () => void;
    mockFhRead.mockImplementationOnce((buffer: Buffer, offset: number, length: number, position: number) =>
      new Promise((resolve) => { completeRead = () => resolve(readMain(buffer, offset, length, position)); }));
    mockPrepare.mockImplementation(() => ({ step: () => false, free: vi.fn(), bind: vi.fn() }));
    const reader = new TracesDbReader();

    const first = reader.querySpans();
    const second = reader.querySpans();
    await vi.waitFor(() => expect(mockFhRead).toHaveBeenCalledTimes(1));
    completeRead();

    expect(await Promise.all([first, second])).toEqual([[], []]);
    expect(mockFhRead).toHaveBeenCalledTimes(1);
    expect(mockPromisesOpen).toHaveBeenCalledTimes(2);
    expect(mockFhClose).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("releases the shared load after a read error so the next query can retry", async () => {
    mockFhRead.mockRejectedValueOnce(new Error("read failed"));
    mockPrepare.mockImplementation(() => ({ step: () => false, free: vi.fn(), bind: vi.fn() }));
    const reader = new TracesDbReader();

    await expect(reader.querySpans()).rejects.toThrow("read failed");
    await expect(reader.querySpans()).resolves.toEqual([]);

    expect(mockPromisesOpen).toHaveBeenCalledTimes(4);
    expect(mockFhClose).toHaveBeenCalledTimes(2);
  });

  it("opens the snapshot read-only and reuses it while the source is unchanged", async () => {
    mockPrepare.mockImplementation(() => ({ step: () => false, free: vi.fn(), bind: vi.fn() }));
    const reader = new TracesDbReader();

    await reader.querySpans();
    await reader.querySpans();

    expect(mockExec).toHaveBeenCalledWith("PRAGMA query_only = ON");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockFhRead).toHaveBeenCalledTimes(1);
    expect(reader.getLastRefresh()).toMatchObject({ mode: "unchanged", bytesRead: 0, snapshotBytes: 2 });
  });

  it("streams spans in bounded batches", async () => {
    const rows = [1, 2, 3].map((index) => ({ span_id: `span-${index}`, start_time_ms: index, input_tokens: 1 }));
    let next = 0;
    prepareSpanRows({
      bind: vi.fn(),
      step: () => next < rows.length,
      getAsObject: () => rows[next++],
      free: vi.fn(),
    });
    const reader = new TracesDbReader();

    const batches: string[][] = [];
    for await (const batch of reader.iterateSpanBatches(undefined, 2)) batches.push(batch.map((span) => span.spanId));

    expect(batches).toEqual([["span-1", "span-2"], ["span-3"]]);
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
        nano_aiu: null,
      })),
      free: vi.fn(),
    };

    prepareSpanRows(statement);

    const reader = new TracesDbReader();
    const spans = await reader.querySpans();

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("copilot_chat.copilot_usage_nano_aiu"));
    expect(spans).toHaveLength(1);
    expect(spans[0].cacheWriteTokens).toBe(0); // always 0 since column was removed
    expect(spans[0].cachedTokens).toBe(25);
    expect(spans[0].inputTokens).toBe(100);
    expect(spans[0].realCredits).toBeUndefined(); // no nano_aiu recorded
  });

  it("reads real credits from nano_aiu attribute", async () => {
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
        span_id: "span-2",
        trace_id: "trace-2",
        parent_span_id: null,
        name: "llm_call",
        start_time_ms: 2000,
        end_time_ms: 2200,
        status_code: 0,
        operation_name: null,
        provider_name: "anthropic",
        agent_name: "GitHub Copilot Chat",
        conversation_id: "conv-2",
        request_model: "claude-opus-4.6",
        response_model: "claude-opus-4.6",
        input_tokens: 50000,
        output_tokens: 500,
        cached_tokens: 10000,
        reasoning_tokens: 0,
        tool_name: null,
        chat_session_id: "session-2",
        turn_index: 1,
        ttft_ms: 100,
        nano_aiu: "4745675000",
      })),
      free: vi.fn(),
    };

    prepareSpanRows(statement);

    const reader = new TracesDbReader();
    const spans = await reader.querySpans();

    expect(spans).toHaveLength(1);
    expect(spans[0].realCredits).toBeCloseTo(4.7457, 3);
  });

  it("preserves a recorded zero nano_aiu as real credits of 0 (free/unbilled turn)", async () => {
    mockExec.mockReturnValue([{ values: [[0, "span_id"]] }]);

    const statement = {
      bind: vi.fn(),
      step: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      getAsObject: vi.fn(() => ({
        span_id: "span-3",
        trace_id: "trace-3",
        parent_span_id: null,
        name: "llm_call",
        start_time_ms: 3000,
        end_time_ms: 3100,
        status_code: 0,
        operation_name: null,
        provider_name: "openai",
        agent_name: "panel/editAgent",
        conversation_id: "conv-3",
        request_model: "gpt-5.4",
        response_model: "gpt-5.4",
        input_tokens: 1000,
        output_tokens: 0,
        cached_tokens: 1000,
        reasoning_tokens: 0,
        tool_name: null,
        chat_session_id: "session-3",
        turn_index: 1,
        ttft_ms: 10,
        nano_aiu: "0",
      })),
      free: vi.fn(),
    };

    prepareSpanRows(statement);

    const reader = new TracesDbReader();
    const spans = await reader.querySpans();

    expect(spans).toHaveLength(1);
    expect(spans[0].realCredits).toBe(0);
  });
});

describe("repoUrlToName", () => {
  it("normalizes https git URLs to Org/Repo and strips .git", () => {
    expect(repoUrlToName("https://github.com/Hoxlegion/copilot-cost-tracker-vsc.git"))
      .toBe("Hoxlegion/copilot-cost-tracker-vsc");
    expect(repoUrlToName("https://github.com/Hoxlegion/copilot-cost-tracker-vsc"))
      .toBe("Hoxlegion/copilot-cost-tracker-vsc");
  });

  it("normalizes ssh git URLs to Org/Repo", () => {
    expect(repoUrlToName("git@github.com:Acme/HCP.Cloud.Core.git")).toBe("Acme/HCP.Cloud.Core");
  });

  it("returns null for empty/missing input", () => {
    expect(repoUrlToName(null)).toBeNull();
    expect(repoUrlToName(undefined)).toBeNull();
    expect(repoUrlToName("")).toBeNull();
    expect(repoUrlToName("   ")).toBeNull();
  });
});