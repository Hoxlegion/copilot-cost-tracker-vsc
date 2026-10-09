import * as fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TracesDbReader } from "../src/parser/tracesDbReader";
import { setUserDataPathOverride } from "../src/shared/paths";
import { FileWatcherStrategy } from "../src/watcher/fileWatcherStrategy";
import { applyWal } from "../src/parser/sqliteSnapshot";

describe("traces WAL integration", () => {
  let userDataDir: string;
  let writer: DatabaseSync;
  let reader: TracesDbReader;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "cost-traces-wal-"));
    const storageDir = join(userDataDir, "globalStorage", "github.copilot-chat");
    await mkdir(storageDir, { recursive: true });
    setUserDataPathOverride(userDataDir);
    writer = new DatabaseSync(join(storageDir, "agent-traces.db"));
    writer.exec(`
      CREATE TABLE spans (
        span_id TEXT PRIMARY KEY, trace_id TEXT, parent_span_id TEXT, name TEXT,
        start_time_ms INTEGER, end_time_ms INTEGER, status_code INTEGER DEFAULT 0,
        operation_name TEXT, provider_name TEXT, agent_name TEXT, conversation_id TEXT,
        request_model TEXT, response_model TEXT, input_tokens INTEGER DEFAULT 10,
        output_tokens INTEGER DEFAULT 2, cached_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0, tool_name TEXT, chat_session_id TEXT,
        turn_index INTEGER, ttft_ms INTEGER
      );
      CREATE TABLE span_attributes (span_id TEXT, key TEXT, value TEXT);
      INSERT INTO spans (span_id, start_time_ms, end_time_ms, agent_name, response_model, chat_session_id)
        VALUES ('checkpointed', 1000, 1100, 'panel/editAgent', 'gpt-5', 'session-1');
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
    `);
    reader = new TracesDbReader(require.resolve("sql.js/dist/sql-wasm.wasm"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    reader?.dispose();
    writer?.close();
    setUserDataPathOverride(undefined);
    await rm(userDataDir, { recursive: true, force: true });
  });

  it("reads newly committed turns before a WAL checkpoint", async () => {
    expect((await reader.querySpans()).map((span) => span.spanId)).toEqual(["checkpointed"]);
    const before = await stat(reader.path);

    writer.exec(`
      INSERT INTO spans (span_id, start_time_ms, end_time_ms, agent_name, response_model, chat_session_id)
        VALUES ('wal-only', 2000, 2100, 'panel/editAgent', 'gpt-5', 'session-1');
      INSERT INTO span_attributes VALUES ('wal-only', 'copilot_chat.copilot_usage_nano_aiu', '2000000000');
    `);

    expect((await stat(reader.path)).mtimeMs).toBe(before.mtimeMs);
    expect((await stat(`${reader.path}-wal`)).size).toBeGreaterThan(32);
    const spans = await reader.querySpans(1000);
    expect(spans.map((span) => span.spanId)).toEqual(["wal-only"]);
    expect(spans[0].realCredits).toBe(2);
  });

  it("does not change the main database, WAL, or shared-memory file", async () => {
    writer.exec("INSERT INTO spans (span_id, start_time_ms, end_time_ms) VALUES ('committed', 2000, 2100)");
    const paths = [reader.path, `${reader.path}-wal`, `${reader.path}-shm`];
    const before = await Promise.all(paths.map((filePath) => readFile(filePath)));

    await reader.querySpans();
    reader.dispose();

    expect(await Promise.all(paths.map((filePath) => readFile(filePath)))).toEqual(before);
  });

  it("ignores spilled frames of an uncommitted transaction", async () => {
    writer.exec("PRAGMA cache_size = 1; BEGIN");
    const insert = writer.prepare("INSERT INTO spans (span_id, start_time_ms, end_time_ms, name) VALUES (?, 2000, 2100, ?)");
    for (let index = 0; index < 50; index++) insert.run(`pending-${index}`, "x".repeat(8192));
    expect((await stat(`${reader.path}-wal`)).size).toBeGreaterThan(32);

    expect((await reader.querySpans()).map((span) => span.spanId)).toEqual(["checkpointed"]);

    writer.exec("COMMIT");
    expect(await reader.querySpans()).toHaveLength(51);
  });

  it("handles a WAL reset with old frames left beyond the new commit", async () => {
    const insert = writer.prepare("INSERT INTO spans (span_id, start_time_ms, end_time_ms) VALUES (?, ?, ?)");
    for (let index = 0; index < 10; index++) insert.run(`old-${index}`, 2000 + index, 2100 + index);
    expect(await reader.querySpans()).toHaveLength(11);
    writer.exec("PRAGMA wal_checkpoint(RESTART)");
    insert.run("after-reset", 3000, 3100);

    expect((await reader.querySpans(2500)).map((span) => span.spanId)).toEqual(["after-reset"]);
    expect(await reader.querySpans()).toHaveLength(12);
  });

  it("rejects a corrupt WAL header and ignores a corrupt final transaction", async () => {
    writer.exec("INSERT INTO spans (span_id, start_time_ms) VALUES ('first-commit', 2000)");
    writer.exec("INSERT INTO spans (span_id, start_time_ms) VALUES ('bad-tail', 3000)");
    const main = await readFile(reader.path);
    const wal = await readFile(`${reader.path}-wal`);
    const badHeader = Buffer.from(wal);
    badHeader.writeUInt32BE(0, 24);
    expect(() => applyWal(Buffer.from(main), badHeader)).toThrow("header checksum");

    const badTail = Buffer.from(wal);
    badTail[badTail.length - 1] ^= 1;
    const SQL = await initSqlJs();
    const snapshot = new SQL.Database(applyWal(Buffer.from(main), badTail));
    try {
      expect(snapshot.exec("SELECT span_id FROM spans ORDER BY start_time_ms")[0].values)
        .toEqual([["checkpointed"], ["first-commit"]]);
    } finally {
      snapshot.close();
    }
  });

  it("retries when a checkpoint changes the source during the snapshot read", async () => {
    writer.exec("INSERT INTO spans (span_id, start_time_ms) VALUES ('before-checkpoint', 2000)");
    const open = fs.promises.open.bind(fs.promises);
    let checkpointed = false;
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[0] === reader.path && !checkpointed) {
        const read = handle.readFile.bind(handle);
        vi.spyOn(handle, "readFile").mockImplementationOnce(async () => {
          checkpointed = true;
          writer.exec("INSERT INTO spans (span_id, start_time_ms) VALUES ('during-checkpoint', 3000); PRAGMA wal_checkpoint(TRUNCATE)");
          return read();
        });
      }
      return handle;
    });

    expect((await reader.querySpans()).map((span) => span.spanId))
      .toEqual(["checkpointed", "before-checkpoint", "during-checkpoint"]);
    expect(checkpointed).toBe(true);
  });

  it("refreshes on a WAL-only change without waiting for the fallback poll", async () => {
    await reader.querySpans();
    let committedAt = 0;
    let visibilityMs = 0;
    const refresh = vi.fn(async () => {
      const count = (await reader.querySpans(1000)).length;
      visibilityMs = performance.now() - committedAt;
      return count;
    });
    const watcher = new FileWatcherStrategy(reader.path, refresh, { debounceMs: 10, fallbackIntervalMs: 60_000 });
    watcher.start();
    try {
      writer.exec(`
        INSERT INTO spans (span_id, start_time_ms, end_time_ms, agent_name, response_model)
          VALUES ('watched-wal', 2000, 2100, 'panel/editAgent', 'gpt-5');
      `);
          committedAt = performance.now();
      await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1500 });
      await expect(refresh.mock.results[0].value).resolves.toBe(1);
          console.info(`WAL fixture commit-to-visible: ${visibilityMs.toFixed(2)} ms (10 ms debounce)`);
    } finally {
      watcher.dispose();
    }
  });
});