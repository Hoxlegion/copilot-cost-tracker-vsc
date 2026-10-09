const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFile, fork } = require("node:child_process");
const { promisify } = require("node:util");
const { performance } = require("node:perf_hooks");

const run = promisify(execFile);
const relativeDb = path.join("globalStorage", "github.copilot-chat", "agent-traces.db");
const MIB = 1024 * 1024;
const RESULT_PREFIX = "RESULT:";
const SCENARIOS = ["touch", "append", "reset", "replay"];
const SYNTHETIC_SPANS = 20;
const DEBOUNCE_MS = 300;

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

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function summarize(spans) {
  return spans.map((span) => ({ id: hash(span.spanId), timestamp: span.startTimeMs, credits: span.realCredits ?? null }));
}

function compareSpans(observed, reference) {
  const expected = new Map(reference.map((span) => [span.id, span]));
  const seen = new Set(observed.map((span) => span.id));
  return {
    spans: observed.length,
    missingSpans: reference.filter((span) => !seen.has(span.id)).length,
    unexpectedSpans: observed.filter((span) => !expected.has(span.id)).length,
    creditMismatches: observed.filter((span) => expected.has(span.id) && expected.get(span.id).credits !== span.credits).length,
  };
}

function turnKey(turn) {
  return `${turn.sessionId}|${turn.timestamp}|${turn.model}`;
}

function digestTurns(database) {
  const turns = database.getAllTurns();
  const rows = turns
    .map((turn) => [turnKey(turn), turn.costSource, turn.credits.toFixed(9), turn.inputTokens, turn.outputTokens, turn.cachedTokens].join("|"))
    .sort();
  return {
    turns: turns.length,
    credits: round(turns.reduce((sum, turn) => sum + turn.credits, 0), 6),
    digest: hash(rows.join("\n")),
  };
}

/** Counts full exports of the cost database by watching renames of its temporary file. */
function countOwnDatabaseExports() {
  const counter = { exports: 0 };
  const track = (from) => {
    if (String(from).endsWith("copilot-costs.db.tmp")) counter.exports++;
  };
  const rename = fsSync.promises.rename;
  fsSync.promises.rename = (from, to) => {
    track(from);
    return rename.call(fsSync.promises, from, to);
  };
  const renameSync = fsSync.renameSync;
  fsSync.renameSync = (from, to) => {
    track(from);
    return renameSync.call(fsSync, from, to);
  };
  return counter;
}

function startMutator(dbPath) {
  const child = fork(__filename, ["--mutator", dbPath], { execArgv: ["--no-warnings"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const pending = new Map();
  let nextId = 0;
  child.on("message", ({ id, result, error }) => {
    const request = pending.get(id);
    pending.delete(id);
    if (error) request?.reject(new Error(error));
    else request?.resolve(result);
  });
  child.on("exit", (code) => {
    for (const request of pending.values()) request.reject(new Error(`Mutator exited with code ${code}`));
    pending.clear();
  });
  const call = (command, ...args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.send({ id, command, args });
  });
  return {
    call,
    async close() {
      const exited = child.exitCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
      await call("close");
      await exited;
    },
  };
}

/** Writes to a temporary copy with SQLite so the reader sees real WAL appends, checkpoints, and restarts. */
function mutator(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA wal_autocheckpoint = 0");
  const quote = (name) => `"${name.replaceAll('"', '""')}"`;
  const copyableColumns = (table) => {
    const columns = database.prepare(`PRAGMA table_info(${quote(table)})`).all();
    const keys = columns.filter((column) => column.pk > 0);
    const rowidAlias = keys.length === 1 && String(keys[0].type).toUpperCase() === "INTEGER" ? keys[0].name : undefined;
    return columns.map((column) => column.name).filter((name) => name !== rowidAlias);
  };
  const spanColumns = copyableColumns("spans");
  const attributeColumns = copyableColumns("span_attributes");
  let clones = 0;

  const commands = {
    reference(since) {
      const rows = database.prepare(`
        SELECT s.span_id, s.start_time_ms, a.value AS nano_aiu
        FROM spans s LEFT JOIN span_attributes a
          ON a.span_id = s.span_id AND a.key = 'copilot_chat.copilot_usage_nano_aiu'
        WHERE s.start_time_ms > ? AND (s.input_tokens > 0 OR s.output_tokens > 0 OR s.cached_tokens > 0)
        ORDER BY s.start_time_ms
      `).all(since);
      return summarize(rows.map((row) => ({
        spanId: row.span_id,
        startTimeMs: row.start_time_ms,
        realCredits: row.nano_aiu == null ? undefined : Number(row.nano_aiu) / 1e9,
      })));
    },
    append(count) {
      const sources = database.prepare(`
        SELECT span_id, start_time_ms FROM spans
        WHERE input_tokens > 0 OR output_tokens > 0 OR cached_tokens > 0
        ORDER BY start_time_ms DESC LIMIT ?
      `).all(count);
      const { latest } = database.prepare("SELECT MAX(start_time_ms) AS latest FROM spans").get();
      database.exec("BEGIN");
      try {
        sources.forEach((source, index) => {
          const spanId = `measure-clone-${++clones}`;
          const shift = latest + (index + 1) * 1000 - source.start_time_ms;
          const params = [];
          const values = spanColumns.map((column) => {
            if (column === "span_id") {
              params.push(spanId);
              return "?";
            }
            if (column === "start_time_ms" || column === "end_time_ms") {
              params.push(shift);
              return `${quote(column)} + ?`;
            }
            return quote(column);
          });
          database.prepare(`INSERT INTO spans (${spanColumns.map(quote).join(", ")}) SELECT ${values.join(", ")} FROM spans WHERE span_id = ?`)
            .run(...params, source.span_id);
          const attributeValues = attributeColumns.map((column) => (column === "span_id" ? "?" : quote(column)));
          database.prepare(`INSERT INTO span_attributes (${attributeColumns.map(quote).join(", ")}) SELECT ${attributeValues.join(", ")} FROM span_attributes WHERE span_id = ?`)
            .run(spanId, source.span_id);
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return sources.length;
    },
    reset(count) {
      // The next commit after a RESTART checkpoint starts a new WAL generation.
      database.exec("PRAGMA wal_checkpoint(RESTART)");
      return commands.append(count);
    },
    close() {
      database.close();
      setImmediate(() => process.exit(0));
      return true;
    },
  };

  process.on("message", ({ id, command, args }) => {
    try {
      process.send({ id, result: commands[command](...args) });
    } catch (error) {
      process.send({ id, error: String(error?.stack ?? error) });
    }
  });
}

function createRuntime(bundle, root) {
  const runtime = require(bundle);
  const wasm = require.resolve("sql.js/dist/sql-wasm.wasm");
  runtime.setUserDataPathOverride(root);
  runtime.setWasmPath(wasm);
  const config = { config: { customModelRates: {}, excludedModels: ["gpt-4o-mini"], excludeUnknownModelsFromTotals: false } };
  const logger = { trace() {}, debug() {}, info() {}, warn() {}, error(message, error) { throw error ?? new Error(message); } };
  return { runtime, wasm, config, logger, pricing: new runtime.PricingEngine(config, logger) };
}

async function openCostDatabase(context, directory) {
  await fs.mkdir(directory, { recursive: true });
  const database = new context.runtime.CostDatabase(directory);
  await database.initialize();
  return database;
}

function createIngester(context, reader, database) {
  const parser = { discoverSessionTitles: () => new Map() };
  const ingester = new context.runtime.TracesIngester(reader, parser, context.pricing, database, context.config, context.logger);
  ingester.setTelemetrySource("database");
  return ingester;
}

async function measurePhase(phase, exportCounter, reader, operation) {
  global.gc?.();
  const exportsBefore = exportCounter.exports;
  const peakBefore = process.resourceUsage().maxRSS;
  const started = performance.now();
  const detail = await operation();
  const ms = performance.now() - started;
  const peakAfter = process.resourceUsage().maxRSS;
  global.gc?.();
  const memory = process.memoryUsage();
  const refresh = reader.getLastRefresh?.();
  return {
    phase,
    ms: round(ms),
    peakRssMiB: round(peakAfter / 1024),
    peakIncreaseMiB: round((peakAfter - peakBefore) / 1024),
    rssAfterGcMiB: round(memory.rss / MIB),
    arrayBuffersMiB: round(memory.arrayBuffers / MIB),
    ownDbExports: exportCounter.exports - exportsBefore,
    ...(refresh ? { refresh: { mode: refresh.mode, bytesRead: refresh.bytesRead, durationMs: round(refresh.durationMs) } } : {}),
    ...detail,
  };
}

async function scenarioWorker(scenario, root, since, bundle) {
  const context = createRuntime(bundle, root);
  const exportCounter = countOwnDatabaseExports();
  const database = await openCostDatabase(context, path.join(root, "own-costs"));
  const reader = new context.runtime.TracesDbReader(context.wasm);
  const ingester = createIngester(context, reader, database);
  const mutation = startMutator(path.join(root, relativeDb));
  const phases = [];
  const verify = async (result) => {
    const reference = await mutation.call("reference", since);
    phases.push({ ...result, ...compareSpans(summarize(await reader.querySpans(since)), reference) });
  };
  try {
    await verify(await measurePhase("cold", exportCounter, reader, async () => {
      const changed = await ingester.ingest(since);
      await database.save();
      return { changed };
    }));
    const coldDigest = digestTurns(database);
    phases.push(await measurePhase("warm", exportCounter, reader, async () => ({ spans: (await reader.querySpans(since)).length })));

    if (scenario === "touch") {
      const walPath = `${reader.path}-wal`;
      const target = await sourceVersion(walPath) === "absent" ? reader.path : walPath;
      await fs.utimes(target, new Date(), new Date(Date.now() + 1000));
      await verify(await measurePhase("touch", exportCounter, reader, async () => ({ spans: (await reader.querySpans(since)).length })));
      phases.push(await measurePhase("idle", exportCounter, reader, async () => {
        for (let save = 0; save < 3; save++) await database.save();
        return { saves: 3 };
      }));
      phases.push(await measurePhase("rescan", exportCounter, reader, async () => {
        const changed = await ingester.fullIngest();
        await database.save();
        return { changed };
      }));
    } else {
      const added = await mutation.call(scenario, SYNTHETIC_SPANS);
      await verify(await measurePhase(scenario, exportCounter, reader, async () => ({ added, changed: await ingester.ingest() })));
    }
    return { scenario, phases, coldDigest, finalDigest: digestTurns(database) };
  } finally {
    await mutation.close();
    ingester.dispose();
    reader.dispose();
    database.close();
  }
}

/** Serves spans that ended before `visibleUntil`, mimicking a traces DB that receives spans as they end. */
function replayReader(spans) {
  const visibleAt = (span) => Math.max(span.startTimeMs, span.endTimeMs);
  return {
    path: "replay-traces.db",
    visibleUntil: Number.POSITIVE_INFINITY,
    exists: () => true,
    getLastRefresh: () => undefined,
    dispose() {},
    visible(sinceMs) {
      return spans
        .filter((span) => visibleAt(span) <= this.visibleUntil && (sinceMs === undefined || span.startTimeMs > sinceMs))
        .map((span) => ({ ...span }));
    },
    async querySpans(sinceMs) {
      return this.visible(sinceMs);
    },
    async *iterateSpanBatches(sinceMs, batchSize) {
      const visible = this.visible(sinceMs);
      for (let index = 0; index < visible.length; index += batchSize) yield visible.slice(index, index + batchSize);
    },
  };
}

async function replayWorker(root, since, bundle) {
  const context = createRuntime(bundle, root);
  const reader = new context.runtime.TracesDbReader(context.wasm);
  let spans;
  try {
    spans = await reader.querySpans(since);
  } finally {
    reader.dispose();
  }
  const traces = replayReader(spans);
  const truthDatabase = await openCostDatabase(context, path.join(root, "replay-truth"));
  const truthIngester = createIngester(context, traces, truthDatabase);
  const replayDatabase = await openCostDatabase(context, path.join(root, "replay"));
  const replayIngester = createIngester(context, traces, replayDatabase);
  try {
    await truthIngester.ingest(0);
    const truth = new Map(truthDatabase.getAllTurns().map((turn) => [turnKey(turn), turn]));
    // Only spans that become turns advance the watermark or need to be caught by the overlap window.
    const stored = (span) => truth.has(turnKey({
      sessionId: span.chatSessionId ?? span.conversationId ?? "unknown",
      timestamp: span.startTimeMs,
      model: span.responseModel ?? span.requestModel ?? "unknown",
    }));

    const visibleAt = (span) => Math.max(span.startTimeMs, span.endTimeMs);
    const ordered = [...spans].sort((a, b) => visibleAt(a) - visibleAt(b));
    let passes = 0;
    let newestStoredStart = Number.NEGATIVE_INFINITY;
    let requiredOverlapMs = 0;
    for (let index = 0; index < ordered.length;) {
      let end = index + 1;
      while (end < ordered.length && visibleAt(ordered[end]) - visibleAt(ordered[end - 1]) <= DEBOUNCE_MS) end++;
      const group = ordered.slice(index, end).filter(stored);
      for (const span of group) requiredOverlapMs = Math.max(requiredOverlapMs, newestStoredStart - span.startTimeMs);
      for (const span of group) newestStoredStart = Math.max(newestStoredStart, span.startTimeMs);
      traces.visibleUntil = visibleAt(ordered[end - 1]);
      await replayIngester.ingest();
      passes++;
      index = end;
    }

    const replayed = new Set(replayDatabase.getAllTurns().map(turnKey));
    const missed = [...truth.values()].filter((turn) => !replayed.has(turnKey(turn)));
    const durations = spans.filter(stored).map((span) => span.endTimeMs - span.startTimeMs).filter((duration) => duration >= 0).sort((a, b) => a - b);
    const percentile = (fraction) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(fraction * durations.length))] : 0);
    return {
      scenario: "replay",
      spans: spans.length,
      passes,
      truthTurns: truth.size,
      replayTurns: replayed.size,
      missedTurns: missed.length,
      missedCredits: round(missed.reduce((sum, turn) => sum + turn.credits, 0), 6),
      extraTurns: [...replayed].filter((key) => !truth.has(key)).length,
      requiredOverlapMs: round(requiredOverlapMs, 0),
      storedSpanDurationMs: { p50: round(percentile(0.5), 0), p95: round(percentile(0.95), 0), p99: round(percentile(0.99), 0), max: round(durations.at(-1) ?? 0, 0) },
    };
  } finally {
    truthIngester.dispose();
    replayIngester.dispose();
    truthDatabase.close();
    replayDatabase.close();
  }
}

function parseArguments(argv) {
  const options = { days: 30 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--freeze") options.freeze = argv[++index];
    else if (argument === "--baseline") options.baseline = argv[++index];
    else if (argument === "--days") options.days = Number(argv[++index]);
    else if (!argument.startsWith("--") && !options.source) options.source = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new Error("--days must be a positive number");
  return options;
}

async function buildRuntime(codeRoot, outfile) {
  if (!fsSync.existsSync(path.join(codeRoot, "src", "parser", "tracesDbReader.ts"))) {
    throw new Error(`${codeRoot} is not a copilot-cost-tracker checkout`);
  }
  await require("esbuild").build({
    stdin: {
      contents: `
        export { TracesDbReader } from './src/parser/tracesDbReader';
        export { TracesIngester } from './src/watcher/tracesIngester';
        export { CostDatabase, setWasmPath } from './src/database/costDatabase';
        export { PricingEngine } from './src/pricing/pricingEngine';
        export { setUserDataPathOverride } from './src/shared/paths';
      `,
      loader: "ts", resolveDir: codeRoot,
    },
    bundle: true, platform: "node", format: "cjs", outfile, external: ["sql.js"], logLevel: "error",
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
}

async function copyCapture(captured, root) {
  const destination = path.join(root, relativeDb);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(captured, destination);
  if (await sourceVersion(`${captured}-wal`) !== "absent") await fs.copyFile(`${captured}-wal`, `${destination}-wal`);
}

async function runWorker(scenario, root, since, bundle) {
  const env = { ...process.env, NODE_PATH: path.resolve(__dirname, "../node_modules") };
  const { stdout } = await run(process.execPath, ["--expose-gc", __filename, "--worker", scenario, root, String(since), bundle], { env, maxBuffer: 64 * MIB });
  const line = stdout.split(/\r?\n/).reverse().find((entry) => entry.startsWith(RESULT_PREFIX));
  if (!line) throw new Error(`The ${scenario} worker produced no result:\n${stdout}`);
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

function summarizeVariant(results) {
  const phase = (scenario, name) => results[scenario]?.phases?.find((entry) => entry.phase === name);
  const median = (values) => {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const pick = (entry) => entry && {
    ms: entry.ms,
    peakIncreaseMiB: entry.peakIncreaseMiB,
    peakRssMiB: entry.peakRssMiB,
    rssAfterGcMiB: entry.rssAfterGcMiB,
    changed: entry.changed,
    ownDbExports: entry.ownDbExports,
    refresh: entry.refresh,
  };
  const measured = ["touch", "append", "reset"];
  return {
    coldIngestAndSaveMs: median(measured.map((scenario) => phase(scenario, "cold")?.ms)),
    coldPeakRssMiB: median(measured.map((scenario) => phase(scenario, "cold")?.peakRssMiB)),
    warmQueryMs: median(measured.map((scenario) => phase(scenario, "warm")?.ms)),
    touchRefresh: pick(phase("touch", "touch")),
    walAppendRefresh: pick(phase("append", "append")),
    walResetRefresh: pick(phase("reset", "reset")),
    idleSaves: pick(phase("touch", "idle")),
    fullRescan: pick(phase("touch", "rescan")),
    lateSpanReplay: results.replay,
  };
}

function findFailures(results) {
  const failures = [];
  const { current, baseline } = results;
  for (const scenario of ["touch", "append", "reset"]) {
    for (const phase of current[scenario].phases) {
      if (phase.missingSpans || phase.unexpectedSpans || phase.creditMismatches) {
        failures.push(`current ${scenario}/${phase.phase}: reader disagrees with the SQLite reference`);
      }
    }
    for (const digest of baseline ? ["coldDigest", "finalDigest"] : []) {
      if (baseline[scenario][digest].digest !== current[scenario][digest].digest) {
        failures.push(`${scenario} ${digest}: stored turns differ from the baseline`);
      }
    }
  }
  if (current.replay.extraTurns) failures.push("replay: incremental ingestion stored turns that a full scan does not");
  return failures;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") {
    const [, scenario, root, since, bundle] = argv;
    const result = scenario === "replay"
      ? await replayWorker(root, Number(since), bundle)
      : await scenarioWorker(scenario, root, Number(since), bundle);
    console.log(RESULT_PREFIX + JSON.stringify(result));
    return;
  }
  if (argv[0] === "--mutator") {
    mutator(argv[1]);
    return;
  }

  const options = parseArguments(argv);
  const userRoot = process.platform === "win32"
    ? path.join(process.env.APPDATA, "Code", "User")
    : path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support" : ".config", "Code", "User");
  const source = options.source ?? path.join(userRoot, relativeDb);
  if (options.freeze) {
    const destination = path.join(path.resolve(options.freeze), "agent-traces.db");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await capture(source, destination);
    console.log(`Captured a consistent main/WAL pair at ${destination}`);
    return;
  }

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cost-traces-measure-"));
  const since = Date.now() - options.days * 86400000;
  try {
    const captured = path.join(temp, "capture", "agent-traces.db");
    await fs.mkdir(path.dirname(captured), { recursive: true });
    await capture(source, captured);
    const variants = [["current", path.resolve(__dirname, "..")]];
    if (options.baseline) variants.unshift(["baseline", path.resolve(options.baseline)]);
    const results = {};
    for (const [variant, codeRoot] of variants) {
      const bundle = path.join(temp, `runtime-${variant}.cjs`);
      await buildRuntime(codeRoot, bundle);
      results[variant] = {};
      for (const scenario of SCENARIOS) {
        const root = path.join(temp, `${variant}-${scenario}`);
        await copyCapture(captured, root);
        try {
          results[variant][scenario] = await runWorker(scenario, root, since, bundle);
        } finally {
          await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
      }
    }
    const failures = findFailures(results);
    console.log(JSON.stringify({
      node: process.version,
      platform: process.platform,
      lookbackDays: options.days,
      mainBytes: (await fs.stat(captured)).size,
      walBytes: (await fs.stat(`${captured}-wal`).catch(() => ({ size: 0 }))).size,
      summary: Object.fromEntries(Object.entries(results).map(([variant, result]) => [variant, summarizeVariant(result)])),
      failures,
      results,
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });