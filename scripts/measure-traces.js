const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { performance } = require("node:perf_hooks");

const run = promisify(execFile);
const relativeDb = path.join("globalStorage", "github.copilot-chat", "agent-traces.db");

async function sourceVersion(filename) {
  try {
    const stat = await fs.stat(filename, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    throw error;
  }
}

async function capture(source, destination, attempt = 0) {
  const before = await Promise.all([sourceVersion(source), sourceVersion(`${source}-wal`)]);
  await fs.copyFile(source, destination);
  if (before[1] !== "absent") await fs.copyFile(`${source}-wal`, `${destination}-wal`);
  const after = await Promise.all([sourceVersion(source), sourceVersion(`${source}-wal`)]);
  if (before.some((version, index) => version !== after[index])) {
    await fs.rm(`${destination}-wal`, { force: true });
    if (attempt < 2) return capture(source, destination, attempt + 1);
    throw new Error("Source changed during all three copy attempts; rerun when tracing is quieter.");
  }
}

function summarize(spans) {
  return spans.map((span) => ({
    id: createHash("sha256").update(span.spanId).digest("hex"),
    timestamp: span.startTimeMs,
    credits: span.realCredits ?? null,
  }));
}

async function worker(mode, root, since, bundle) {
  const filename = path.join(root, relativeDb);
  if (mode === "reference") {
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
      const start = performance.now();
      const rows = database.prepare(`
        SELECT s.span_id, s.start_time_ms, a.value AS nano_aiu
        FROM spans s LEFT JOIN span_attributes a
          ON a.span_id = s.span_id AND a.key = 'copilot_chat.copilot_usage_nano_aiu'
        WHERE s.start_time_ms > ? AND (s.input_tokens > 0 OR s.output_tokens > 0 OR s.cached_tokens > 0)
        ORDER BY s.start_time_ms
      `).all(since);
      const queryMs = performance.now() - start;
      return {
        mode, queryMs, peakRssMiB: process.resourceUsage().maxRSS / 1024,
        spans: summarize(rows.map((row) => ({
          spanId: row.span_id, startTimeMs: row.start_time_ms,
          realCredits: row.nano_aiu == null ? undefined : Number(row.nano_aiu) / 1e9,
        }))),
      };
    } finally {
      database.close();
    }
  }

  const runtime = require(bundle);
  runtime.setUserDataPathOverride(root);
  runtime.setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
  const ownStorage = path.join(root, "own-costs");
  await fs.mkdir(ownStorage);
  const database = new runtime.CostDatabase(ownStorage);
  await database.initialize();
  const reader = new runtime.TracesDbReader(require.resolve("sql.js/dist/sql-wasm.wasm"));
  const config = { config: { customModelRates: {}, excludedModels: ["gpt-4o-mini"], excludeUnknownModelsFromTotals: false } };
  const logger = { debug() {}, info() {}, warn() {}, error(message, error) { throw error ?? new Error(message); } };
  const pricing = new runtime.PricingEngine(config, logger);
  const parser = { discoverSessionTitles: () => new Map() };
  const ingester = new runtime.TracesIngester(reader, parser, pricing, database, config, logger);
  ingester.setTelemetrySource("database");
  try {
    const start = performance.now();
    const processed = await ingester.ingest(since);
    await database.save();
    const ingestMs = performance.now() - start;
    const coldPeakRssMiB = process.resourceUsage().maxRSS / 1024;
    const warmStart = performance.now();
    const spans = await reader.querySpans(since);
    const warmQueryMs = performance.now() - warmStart;
    const walPath = `${reader.path}-wal`;
    const refreshTarget = await sourceVersion(walPath) === "absent" ? reader.path : walPath;
    await fs.utimes(refreshTarget, new Date(), new Date(Date.now() + 1000));
    const refreshStart = performance.now();
    const refreshed = await reader.querySpans(since);
    const reloadQueryMs = performance.now() - refreshStart;
    if (JSON.stringify(summarize(refreshed)) !== JSON.stringify(summarize(spans))) {
      throw new Error("Repeated read changed the captured spans");
    }
    return {
      mode, processed, ingestMs, warmQueryMs, reloadQueryMs, coldPeakRssMiB,
      peakRssMiB: process.resourceUsage().maxRSS / 1024, spans: summarize(spans),
    };
  } finally {
    ingester.dispose();
    reader.dispose();
    database.close();
  }
}

async function main() {
  if (process.argv[2] === "--worker") {
    const result = await worker(process.argv[3], process.argv[4], Number(process.argv[5]), process.argv[6]);
    console.log(JSON.stringify(result));
    return;
  }
  const userRoot = process.platform === "win32"
    ? path.join(process.env.APPDATA, "Code", "User")
    : path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support" : ".config", "Code", "User");
  const source = process.argv[2] ?? path.join(userRoot, relativeDb);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cost-traces-measure-"));
  const since = Date.now() - 30 * 86400000;
  try {
    const snapshotRoot = path.join(temp, "snapshot");
    const mainOnlyRoot = path.join(temp, "main-only");
    await fs.mkdir(path.dirname(path.join(snapshotRoot, relativeDb)), { recursive: true });
    await fs.mkdir(path.dirname(path.join(mainOnlyRoot, relativeDb)), { recursive: true });
    const captured = path.join(snapshotRoot, relativeDb);
    await capture(source, captured);
    await fs.link(captured, path.join(mainOnlyRoot, relativeDb));
    const bundle = path.join(temp, "runtime.cjs");
    await require("esbuild").build({
      stdin: {
        contents: `
          export { TracesDbReader } from './src/parser/tracesDbReader';
          export { TracesIngester } from './src/watcher/tracesIngester';
          export { CostDatabase, setWasmPath } from './src/database/costDatabase';
          export { PricingEngine } from './src/pricing/pricingEngine';
          export { setUserDataPathOverride } from './src/shared/paths';
        `,
        loader: "ts", resolveDir: path.resolve(__dirname, ".."),
      },
      bundle: true, platform: "node", format: "cjs", outfile: bundle, external: ["sql.js"],
      plugins: [{
        name: "measurement-vscode",
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "measurement" }));
          build.onLoad({ filter: /.*/, namespace: "measurement" }, () => ({ contents: `
            export class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
            export const workspace = { getConfiguration: () => ({ get: (_key, fallback) => fallback }) };
          ` }));
        },
      }],
    });
    const env = { ...process.env, NODE_PATH: path.resolve(__dirname, "../node_modules") };
    const baseline = JSON.parse((await run(process.execPath, [__filename, "--worker", "main-only", mainOnlyRoot, String(since), bundle], { env, maxBuffer: 32 * 1024 * 1024 })).stdout);
    const snapshot = JSON.parse((await run(process.execPath, [__filename, "--worker", "wal-snapshot", snapshotRoot, String(since), bundle], { env, maxBuffer: 32 * 1024 * 1024 })).stdout);
    const reference = JSON.parse((await run(process.execPath, [__filename, "--worker", "reference", snapshotRoot, String(since), bundle], { env, maxBuffer: 32 * 1024 * 1024 })).stdout);
    const expected = new Map(reference.spans.map((span) => [span.id, span]));
    const analyze = (result) => {
      const observed = new Map(result.spans.map((span) => [span.id, span]));
      const missing = reference.spans.filter((span) => !observed.has(span.id));
      return {
        mode: result.mode, spanCount: result.spans.length, processed: result.processed,
        ingestMs: result.ingestMs, warmQueryMs: result.warmQueryMs, reloadQueryMs: result.reloadQueryMs, queryMs: result.queryMs,
        coldPeakRssMiB: result.coldPeakRssMiB,
        peakRssMiB: result.peakRssMiB, missingSpans: missing.length,
        unexpectedSpans: result.spans.filter((span) => !expected.has(span.id)).length,
        creditMismatches: result.spans.filter((span) => expected.has(span.id) && expected.get(span.id).credits !== span.credits).length,
        oldestMissingAgeMs: missing.length ? Date.now() - Math.min(...missing.map((span) => span.timestamp)) : 0,
      };
    };
    const results = [analyze(baseline), analyze(snapshot), analyze(reference)];
    console.log(JSON.stringify({
      node: process.version, platform: process.platform, lookbackDays: 30,
      mainBytes: (await fs.stat(captured)).size,
      walBytes: (await fs.stat(`${captured}-wal`).catch(() => ({ size: 0 }))).size,
      results,
    }, null, 2));
    if (results[1].missingSpans || results[1].unexpectedSpans || results[1].creditMismatches) {
      throw new Error("WAL snapshot disagrees with the SQLite reference");
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });