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

const SCHEMA = `
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
`;

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
      ${SCHEMA}
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

  function insertSpan(spanId: string, startMs: number, name = ""): void {
    writer.prepare("INSERT INTO spans (span_id, start_time_ms, end_time_ms, name) VALUES (?, ?, ?, ?)")
      .run(spanId, startMs, startMs + 100, name);
  }

  function insertLargeSpans(count: number): void {
    writer.exec("BEGIN");
    for (let index = 0; index < count; index++) insertSpan(`large-${index}`, 10_000 + index, "x".repeat(16_384));
    writer.exec("COMMIT");
  }

  async function spanIds(sinceMs?: number): Promise<string[]> {
    return (await reader.querySpans(sinceMs)).map((span) => span.spanId);
  }

  /** Wraps `FileHandle.read` for every opened file; `onRead` runs before each read. */
  function interceptReads(onRead: (filePath: string, call: number) => void = () => {}): Map<string, number> {
    const bytesByPath = new Map<string, number>();
    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      const filePath = String(args[0]);
      const read = handle.read.bind(handle) as (...readArgs: unknown[]) => Promise<{ bytesRead: number }>;
      let calls = 0;
      vi.spyOn(handle, "read").mockImplementation((async (...readArgs: unknown[]) => {
        onRead(filePath, ++calls);
        const result = await read(...readArgs);
        bytesByPath.set(filePath, (bytesByPath.get(filePath) ?? 0) + result.bytesRead);
        return result;
      }) as never);
      return handle;
    });
    return bytesByPath;
  }

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
    await reader.querySpans();
    writer.exec("INSERT INTO spans (span_id, start_time_ms, end_time_ms) VALUES ('appended', 3000, 3100)");
    const paths = [reader.path, `${reader.path}-wal`, `${reader.path}-shm`];
    const before = await Promise.all(paths.map((filePath) => readFile(filePath)));

    await reader.querySpans();
    expect(reader.getLastRefresh()?.mode).toBe("incremental");
    reader.dispose();
    await reader.querySpans();
    expect(reader.getLastRefresh()?.mode).toBe("full");
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
    let checkpointed = false;
    interceptReads((filePath) => {
      if (filePath !== reader.path || checkpointed) return;
      checkpointed = true;
      writer.exec("INSERT INTO spans (span_id, start_time_ms) VALUES ('during-checkpoint', 3000); PRAGMA wal_checkpoint(TRUNCATE)");
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

  it("applies new WAL commits without rereading the main database", async () => {
    insertSpan("first-wal", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "first-wal"]);
    expect(reader.getLastRefresh()?.mode).toBe("full");
    const capacity = reader.getLastRefresh()?.capacityBytes;
    const reads = interceptReads();

    writer.exec(`
      INSERT INTO spans (span_id, start_time_ms, end_time_ms) VALUES ('appended', 3000, 3100);
      INSERT INTO span_attributes VALUES ('appended', 'copilot_chat.copilot_usage_nano_aiu', '3000000000');
    `);
    const spans = await reader.querySpans(2500);

    expect(spans.map((span) => span.spanId)).toEqual(["appended"]);
    expect(spans[0].realCredits).toBe(3);
    expect(reader.getLastRefresh()).toMatchObject({ mode: "incremental", capacityBytes: capacity });
    expect(reads.get(reader.path) ?? 0).toBe(0);
    expect(reader.getLastRefresh()?.bytesRead).toBeLessThan((await stat(`${reader.path}-wal`)).size);
  });

  it("stays incremental when a checkpoint copies pages within the same WAL generation", async () => {
    insertSpan("first-commit", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "first-commit"]);
    const pinned = new DatabaseSync(reader.path);
    try {
      pinned.exec("BEGIN");
      pinned.prepare("SELECT COUNT(*) FROM spans").get();
      // A different table keeps the newest spans page inside the pinned range, so it is backfilled.
      writer.exec("INSERT INTO span_attributes VALUES ('first-commit', 'copilot_chat.copilot_usage_nano_aiu', '1000000000')");
      const mainBefore = await readFile(reader.path);
      writer.exec("PRAGMA wal_checkpoint(PASSIVE)");
      expect(await readFile(reader.path)).not.toEqual(mainBefore);
      insertSpan("second-commit", 3000);

      const spans = await reader.querySpans();
      expect(spans.map((span) => span.spanId)).toEqual(["checkpointed", "first-commit", "second-commit"]);
      expect(spans[1].realCredits).toBe(1);
      expect(reader.getLastRefresh()?.mode).toBe("incremental");
    } finally {
      pinned.exec("COMMIT");
      pinned.close();
    }
  });

  it("reloads commits that a WAL restart moved into the main database", async () => {
    insertSpan("seen", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "seen"]);
    insertSpan("unseen-before-restart", 3000);
    writer.exec("PRAGMA wal_checkpoint(RESTART)");
    insertSpan("after-restart", 4000);

    expect(await spanIds()).toEqual(["checkpointed", "seen", "unseen-before-restart", "after-restart"]);
    expect(reader.getLastRefresh()?.mode).toBe("full");
  });

  it("reloads when the WAL is truncated or removed", async () => {
    insertSpan("in-wal", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "in-wal"]);

    insertSpan("truncated", 3000);
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    expect((await stat(`${reader.path}-wal`)).size).toBe(0);
    expect(await spanIds(2500)).toEqual(["truncated"]);
    expect(reader.getLastRefresh()?.mode).toBe("full");

    writer.exec("PRAGMA journal_mode = DELETE");
    insertSpan("rollback-journal", 4000);
    expect(fs.existsSync(`${reader.path}-wal`)).toBe(false);
    expect(await spanIds(3500)).toEqual(["rollback-journal"]);
    expect(reader.getLastRefresh()?.mode).toBe("full");
  });

  it("reallocates the snapshot once the database outgrows its headroom", async () => {
    insertSpan("small", 2000);
    await reader.querySpans();
    const before = reader.getLastRefresh()!;

    insertLargeSpans(64);
    expect(await reader.querySpans()).toHaveLength(66);
    const after = reader.getLastRefresh()!;
    expect(after.mode).toBe("full");
    expect(after.snapshotBytes).toBeGreaterThan(before.capacityBytes);
    expect(after.capacityBytes).toBeGreaterThan(after.snapshotBytes);
  });

  it("shrinks the snapshot when a WAL commit truncates the database", async () => {
    insertLargeSpans(64);
    expect(await reader.querySpans()).toHaveLength(65);
    const grown = reader.getLastRefresh()!;

    writer.exec("DELETE FROM spans WHERE span_id LIKE 'large-%'; VACUUM");
    insertSpan("after-vacuum", 2000);

    expect(await spanIds()).toEqual(["checkpointed", "after-vacuum"]);
    const shrunk = reader.getLastRefresh()!;
    expect(shrunk.mode).toBe("incremental");
    expect(shrunk.snapshotBytes).toBeLessThan(grown.snapshotBytes);
    expect(shrunk.capacityBytes).toBe(grown.capacityBytes);
  });

  it("reloads when the database file is replaced", async () => {
    insertSpan("original", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "original"]);
    writer.close();
    await Promise.all(["", "-wal", "-shm"].map((suffix) => rm(`${reader.path}${suffix}`, { force: true })));
    writer = new DatabaseSync(reader.path);
    writer.exec(`${SCHEMA} PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;`);
    insertSpan("replacement", 5000);

    expect(await spanIds()).toEqual(["replacement"]);
    expect(reader.getLastRefresh()?.mode).toBe("full");
  });

  it("keeps a consistent snapshot when the WAL is appended to or restarted during an incremental read", async () => {
    insertSpan("first", 2000);
    expect(await spanIds()).toEqual(["checkpointed", "first"]);
    insertSpan("second", 3000);
    let injected = false;
    interceptReads((filePath, call) => {
      if (filePath !== `${reader.path}-wal` || call !== 2 || injected) return;
      injected = true;
      insertSpan("appended-during-read", 4000);
      writer.exec("PRAGMA wal_checkpoint(RESTART)");
      insertSpan("after-restart", 5000);
    });

    const during = await spanIds();
    expect(injected).toBe(true);
    vi.restoreAllMocks();
    const expected = ["checkpointed", "first", "second", "appended-during-read", "after-restart"];
    expect(await spanIds()).toEqual(expected);
    expect(during.length).toBeGreaterThanOrEqual(2);
    expect(expected.slice(0, during.length)).toEqual(during);
  });

  it("does not refresh the snapshot while spans are being iterated", async () => {
    insertSpan("first", 2000);
    const batches = reader.iterateSpanBatches(undefined, 1);
    const first = await batches.next();
    expect(first.done ? [] : first.value.map((span) => span.spanId)).toEqual(["checkpointed"]);

    insertSpan("during-iteration", 3000);
    expect(await spanIds()).toEqual(["checkpointed", "first"]);
    const remaining: string[] = [];
    for await (const batch of batches) remaining.push(...batch.map((span) => span.spanId));

    expect(remaining).toEqual(["first"]);
    expect(await spanIds()).toEqual(["checkpointed", "first", "during-iteration"]);
  });

  it("lets sql.js read the snapshot buffer in place instead of copying it", async () => {
    // Guards the memory model: correctness does not depend on this, but peak memory does.
    const SQL = await initSqlJs();
    const image = Buffer.from(await readFile(reader.path));
    const db = new SQL.Database(image);
    try {
      image.fill(0, 0, 16);
      expect(() => db.exec("SELECT COUNT(*) FROM spans")).toThrow();
    } finally {
      db.close();
    }
  });
});