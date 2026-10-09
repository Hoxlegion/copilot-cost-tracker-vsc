// Dev-only probe for Copilot CLI session logs. Prints structure and numbers only, never message content.
// Usage: node scripts/inspect-cli-sessions.js [copilotHome ...] [--traces <agent-traces.db>] [--session-db]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

const USAGE_TYPES = new Set(["session.shutdown", "session.usage_checkpoint"]);
const LIFETIME_TYPES = new Set(["session.start", "session.resume"]);
const TYPE_PREFIX = /^\{"type":"([^"]+)"/;

function parseArgs(argv) {
  const roots = [];
  let traces = null;
  let sessionDb = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--traces") traces = argv[++i];
    else if (argv[i] === "--session-db") sessionDb = true;
    else roots.push(argv[i]);
  }
  if (roots.length === 0) roots.push(path.join(os.homedir(), ".copilot"));
  return { roots, traces, sessionDb };
}

function modelSummary(modelMetrics) {
  const out = {};
  for (const [model, metric] of Object.entries(modelMetrics ?? {})) {
    if (!metric) continue;
    const usage = metric.usage ?? {};
    const details = metric.tokenDetails ?? {};
    out[model] = {
      requests: metric.requests?.count,
      premiumCost: metric.requests?.cost,
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens,
      cacheWrite: usage.cacheWriteTokens,
      reasoning: usage.reasoningTokens,
      nanoAiu: metric.totalNanoAiu,
      detailInput: details.input?.tokenCount,
      detailCacheRead: details.cache_read?.tokenCount,
      detailCacheWrite: details.cache_write?.tokenCount,
      detailOutput: details.output?.tokenCount,
    };
  }
  return out;
}

function providerModelSummary(list) {
  if (!Array.isArray(list)) return undefined;
  const out = {};
  for (const entry of list) {
    const key = `${entry?.provider?.kind ?? "?"}:${entry?.modelId ?? "null"}`;
    out[key] = modelSummary({ m: entry?.metrics }).m;
  }
  return out;
}

async function inspectFile(file) {
  const result = {
    lines: 0,
    malformed: 0,
    versions: new Set(),
    counts: {},
    lifetimes: 0,
    agentEvents: 0,
    messageOutputTokens: 0,
    messageModels: new Set(),
    firstTs: null,
    lastTs: null,
    lastType: null,
    snapshots: [],
  };
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    result.lines++;
    const match = TYPE_PREFIX.exec(line.slice(0, 120));
    const type = match?.[1] ?? "?";
    result.counts[type] = (result.counts[type] ?? 0) + 1;
    result.lastType = type;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      result.malformed++;
      continue;
    }
    if (event.timestamp) {
      result.firstTs ??= event.timestamp;
      result.lastTs = event.timestamp;
    }
    if (event.agentId) result.agentEvents++;
    const data = event.data ?? {};
    if (LIFETIME_TYPES.has(type)) {
      result.lifetimes++;
      if (data.copilotVersion) result.versions.add(data.copilotVersion);
      result.snapshots.push({ kind: type, ts: event.timestamp, eventCount: data.eventCount });
    } else if (type === "assistant.message") {
      result.messageOutputTokens += Number(data.outputTokens ?? 0);
      if (data.model) result.messageModels.add(data.model);
    } else if (USAGE_TYPES.has(type)) {
      result.snapshots.push({
        kind: type,
        ts: event.timestamp,
        agentId: event.agentId,
        keys: Object.keys(data).sort(),
        shutdownType: data.shutdownType,
        totalNanoAiu: data.totalNanoAiu,
        totalPremiumRequests: data.totalPremiumRequests,
        totalApiDurationMs: data.totalApiDurationMs,
        sessionStartTime: data.sessionStartTime,
        watermarks: data.usageAccountingWatermarks,
        models: modelSummary(data.modelMetrics),
        providerModels: providerModelSummary(data.providerModelMetrics),
        snapshotNanoAiu: data.accountingSnapshot?.totalNanoAiu,
        snapshotModels: data.accountingSnapshot ? modelSummary(data.accountingSnapshot.modelMetrics) : undefined,
        agents: data.agentMetrics
          ? Object.fromEntries(Object.entries(data.agentMetrics).map(([k, v]) => [k, { name: v?.agentName, nanoAiu: v?.totalNanoAiu }]))
          : undefined,
      });
    }
  }
  return result;
}

function readOrigins(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "vscode.session.metadata.cache.json"), "utf8"));
    return new Map(Object.entries(raw).map(([id, value]) => [id, value?.origin ?? "?"]));
  } catch {
    return new Map();
  }
}

function sessionDbTables(dir) {
  const file = path.join(dir, "session.db");
  if (!fs.existsSync(file)) return null;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    db.close();
    return tables;
  } catch (error) {
    return [`<error: ${error.code ?? error.message}>`];
  }
}

function tracesOverlap(tracesPath, sessionIds) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(tracesPath, { readOnly: true });
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT chat_session_id AS chat, conversation_id AS conv, COUNT(*) AS spans,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output
       FROM spans
       WHERE chat_session_id IN (${placeholders}) OR conversation_id IN (${placeholders})
       GROUP BY chat_session_id, conversation_id`,
    )
    .all(...sessionIds, ...sessionIds);
  db.close();
  return rows;
}

async function main() {
  const { roots, traces, sessionDb } = parseArgs(process.argv.slice(2));
  const allIds = [];
  for (const root of roots) {
    const stateDir = path.join(root, "session-state");
    const origins = readOrigins(root);
    let dirs = [];
    try {
      dirs = fs.readdirSync(stateDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch (error) {
      console.log(`${root}: no session-state (${error.code})`);
      continue;
    }
    console.log(`\n# ${root} — ${dirs.length} session dirs`);
    for (const dir of dirs) {
      const sessionDir = path.join(stateDir, dir.name);
      const file = path.join(sessionDir, "events.jsonl");
      allIds.push(dir.name);
      if (!fs.existsSync(file)) {
        console.log(`\n## ${dir.name}: no events.jsonl (origin ${origins.get(dir.name) ?? "-"})`);
        continue;
      }
      const stat = fs.statSync(file);
      const info = await inspectFile(file);
      console.log(`\n## ${dir.name} origin=${origins.get(dir.name) ?? "-"} size=${stat.size} lines=${info.lines} malformed=${info.malformed}`);
      console.log(`versions=${[...info.versions].join(",") || "-"} lifetimes=${info.lifetimes} first=${info.firstTs} last=${info.lastTs} lastType=${info.lastType}`);
      console.log(`agentEvents=${info.agentEvents} messageOutputTokens=${info.messageOutputTokens} messageModels=${[...info.messageModels].join(",")}`);
      const interesting = Object.entries(info.counts)
        .filter(([type]) => /^(session\.|subagent\.|abort|assistant\.(message|usage|turn_start))/.test(type))
        .map(([type, count]) => `${type}:${count}`)
        .join(" ");
      console.log(`counts: ${interesting}`);
      for (const snapshot of info.snapshots) console.log(JSON.stringify(snapshot));
      if (sessionDb) console.log(`session.db tables: ${JSON.stringify(sessionDbTables(sessionDir))}`);
    }
  }
  if (traces && allIds.length > 0) {
    console.log(`\n# Overlap with ${traces}`);
    const rows = tracesOverlap(traces, allIds);
    console.log(rows.length === 0 ? "none" : rows.map((row) => JSON.stringify(row)).join("\n"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
