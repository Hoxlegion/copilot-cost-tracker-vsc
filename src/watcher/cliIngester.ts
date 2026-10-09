import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  cliRowToTurn,
  cliSessionStatus,
  computeCliUsageRows,
  parseCliSessionLog,
  parseWorkspaceYaml,
  type CliSessionLog,
} from "../parser/cliSessionParser";
import { repoUrlToName } from "../parser/tracesDbReader";
import { readOriginUrl } from "../shared/gitRemote";
import type { CliSourceState, CliStore, CostedTurn } from "../database/types";
import type { ConfigManager } from "../config";
import type { Logger } from "../logger";
import type { PricingEngine } from "../pricing";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SCAN_INTERVAL_MS = 10_000;
const SESSION_DIR_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_TITLE_LENGTH = 200;

export interface CliIngestOptions {
  /** Re-parse every session log and skip the scan throttle. */
  force?: boolean;
}

export interface CliIngestResult {
  /** Sessions whose stored usage changed (including rows removed because Copilot Chat has them). */
  sessions: number;
  /** Usage rows written for those sessions. */
  turns: number;
}

interface SessionResult {
  changed: boolean;
  turns: number;
}

const UNCHANGED: SessionResult = { changed: false, turns: 0 };

interface Candidate {
  sessionId: string;
  dir: string;
  filePath: string;
  size: number;
  mtimeMs: number;
}

/** Default CLI home, as documented by `copilot help environment`. */
export function defaultCliHome(): string {
  return process.env.COPILOT_HOME?.trim() || path.join(os.homedir(), ".copilot");
}

/**
 * Imports GitHub Copilot CLI usage from `<home>/session-state/<id>/events.jsonl`.
 * Each changed log is re-parsed in full and its rows replace the session's previous CLI rows, so
 * re-reading a log, resumed sessions and appended events never count usage twice.
 */
export class CliIngester {
  private lastScanMs = 0;
  private forceNext = false;

  constructor(
    private readonly database: CliStore,
    private readonly pricing: Pick<PricingEngine, "calculateCost" | "costToCredits">,
    private readonly configManager: Pick<ConfigManager, "config">,
    private readonly logger: Pick<Logger, "debug" | "info" | "warn">,
  ) {}

  /** Make the next scan re-parse every log (e.g. after the CLI settings changed). */
  invalidate(): void {
    this.forceNext = true;
  }

  /** Imports new and changed session logs; unchanged logs and unchanged usage cause no writes. */
  async ingest(options: CliIngestOptions = {}): Promise<CliIngestResult> {
    const config = this.configManager.config;
    if (!config.cliEnabled) return { sessions: 0, turns: 0 };

    const force = options.force === true || this.forceNext;
    const now = Date.now();
    if (!force && now - this.lastScanMs < MIN_SCAN_INTERVAL_MS) return { sessions: 0, turns: 0 };
    this.lastScanMs = now;
    this.forceNext = false;

    const roots = config.cliHomePaths.length > 0 ? config.cliHomePaths : [defaultCliHome()];
    const candidates = await this.discover(roots);
    const known = this.database.getCliSourceStates();
    const originCache = new Map<string, string | null>();

    const result: CliIngestResult = { sessions: 0, turns: 0 };
    for (const candidate of candidates.values()) {
      const previous = known.get(candidate.sessionId);
      const unchanged = previous !== undefined
        && previous.filePath === candidate.filePath
        && previous.size === candidate.size
        && previous.mtimeMs === candidate.mtimeMs;
      if (unchanged && !force) continue;
      const session = await this.ingestSession(candidate, originCache);
      if (session.changed) {
        result.sessions++;
        result.turns += session.turns;
      }
    }

    const shadowed = this.database.deleteCliTurnsShadowedByChat();
    if (shadowed.length > 0) {
      this.logger.warn(`Copilot CLI: ${shadowed.length} session(s) are also recorded by Copilot Chat; keeping the Chat data`);
      result.sessions += shadowed.length;
    }
    if (result.sessions > 0) {
      this.logger.debug(`Copilot CLI: updated ${result.sessions} session(s) from ${candidates.size} session log(s)`);
    }
    return result;
  }

  /** One candidate per session id; a session found under several homes keeps its newest log. */
  private async discover(roots: string[]): Promise<Map<string, Candidate>> {
    const candidates = new Map<string, Candidate>();
    for (const root of roots) {
      const stateDir = path.join(root, "session-state");
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(stateDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !SESSION_DIR_PATTERN.test(entry.name)) continue;
        const dir = path.join(stateDir, entry.name);
        const filePath = path.join(dir, "events.jsonl");
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(filePath);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const candidate: Candidate = { sessionId: entry.name, dir, filePath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
        const existing = candidates.get(entry.name);
        if (
          !existing
          || candidate.mtimeMs > existing.mtimeMs
          || (candidate.mtimeMs === existing.mtimeMs && candidate.size > existing.size)
        ) {
          candidates.set(entry.name, candidate);
        }
      }
    }
    return candidates;
  }

  private async ingestSession(candidate: Candidate, originCache: Map<string, string | null>): Promise<SessionResult> {
    const state: CliSourceState = {
      sessionId: candidate.sessionId,
      filePath: candidate.filePath,
      size: candidate.size,
      mtimeMs: candidate.mtimeMs,
      status: "ok",
      lastEventMs: 0,
    };

    let log: CliSessionLog;
    try {
      log = await readSessionLog(candidate.filePath);
    } catch (err) {
      this.logger.warn(`Copilot CLI: could not read session log ${candidate.filePath}`, err);
      this.database.markCliSource({ ...state, status: "error" });
      return UNCHANGED;
    }

    const rows = computeCliUsageRows(log);
    state.status = cliSessionStatus(log, rows);
    state.lastEventMs = log.lastEventMs;

    const config = this.configManager.config;
    const excluded = config.excludedModels.map((m) => m.toLowerCase());
    const retentionCutoff = Date.now() - config.retentionDays * DAY_MS;
    const kept = rows.filter((row) =>
      row.timestamp >= retentionCutoff && !excluded.some((e) => row.model.toLowerCase().includes(e)));

    if (kept.length > 0 && this.database.hasChatTurns(candidate.sessionId)) {
      const changed = this.database.replaceCliSession({ ...state, status: "shadowed" }, null, []);
      if (changed) {
        this.logger.warn(`Copilot CLI: session ${candidate.sessionId} is also recorded by Copilot Chat; keeping the Chat data`);
      }
      return { changed, turns: 0 };
    }
    if (kept.length === 0) {
      return { changed: this.database.replaceCliSession(state, null, []), turns: 0 };
    }

    const sidecars = await readSidecars(candidate.dir);
    const workspace = resolveWorkspace(log, sidecars.yaml, originCache);
    const costed = kept.map((row): CostedTurn => {
      const turn = cliRowToTurn(row, candidate.sessionId);
      if (turn.costSource === "real") {
        const credits = row.totals.nanoAiu / 1e9;
        return { turn, credits, costUsd: credits / 100, workspace };
      }
      const costUsd = this.pricing.calculateCost(turn.model, turn.inputTokens, turn.outputTokens, turn.cachedTokens, turn.cacheWriteTokens);
      return { turn, costUsd, credits: this.pricing.costToCredits(costUsd), workspace };
    });

    // Rows are sorted by time; deriving both bounds from them keeps rewrites deterministic.
    const changed = this.database.replaceCliSession(state, {
      workspace,
      startTimestamp: Math.min(log.startMs ?? kept[0].timestamp, kept[0].timestamp),
      lastTimestamp: kept[kept.length - 1].timestamp,
      copilotVersion: log.copilotVersion,
      title: sidecars.title,
    }, costed);
    return { changed, turns: changed ? costed.length : 0 };
  }
}

async function readSessionLog(filePath: string): Promise<CliSessionLog> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    return await parseCliSessionLog(lines);
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function readSidecars(dir: string): Promise<{ title: string | null; yaml: Record<string, string> }> {
  const yaml = parseWorkspaceYaml(await readTextOrEmpty(path.join(dir, "workspace.yaml")));
  let customTitle: string | null = null;
  try {
    const metadata = JSON.parse(await readTextOrEmpty(path.join(dir, "vscode.metadata.json")) || "{}") as { customTitle?: unknown };
    customTitle = typeof metadata.customTitle === "string" && metadata.customTitle.trim() ? metadata.customTitle.trim() : null;
  } catch {
    // Malformed metadata only costs us the title.
  }
  const title = customTitle ?? yaml.name ?? null;
  return { title: title ? title.slice(0, MAX_TITLE_LENGTH) : null, yaml };
}

async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/** Same label Copilot Chat rows get ("Org/Repo" from the git remote), so both sources group together. */
function resolveWorkspace(log: CliSessionLog, yaml: Record<string, string>, originCache: Map<string, string | null>): string {
  const gitRoot = log.context.gitRoot ?? yaml.git_root ?? null;
  if (gitRoot) {
    if (!originCache.has(gitRoot)) originCache.set(gitRoot, repoUrlToName(readOriginUrl(gitRoot)));
    const label = originCache.get(gitRoot);
    if (label) return label;
  }
  return log.context.repository ?? yaml.repository ?? log.context.cwd ?? yaml.cwd ?? "unknown";
}
