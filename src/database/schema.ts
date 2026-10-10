import type { Database } from "sql.js";

export function createTables(db: Database): void {
  createTurnsTable(db);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      start_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL,
      copilot_version TEXT,
      vscode_version TEXT,
      processed_at INTEGER NOT NULL,
      title TEXT
    )
  `);

  ensureTurnsSchema(db);
  ensureSessionsSchema(db);

  // Fingerprints of ingested Copilot CLI session logs, so unchanged files are not re-parsed.
  db.run(`
    CREATE TABLE IF NOT EXISTS cli_sources (
      session_id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_event_ms INTEGER NOT NULL DEFAULT 0,
      parsed_at INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_workspace ON turns(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model_family)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_source_timestamp ON turns(source, timestamp)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_span_identity ON turns(source, span_id) WHERE span_id IS NOT NULL`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_legacy_identity ON turns(session_id, timestamp, model) WHERE span_id IS NULL`);
}

function createTurnsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      agent_name TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL,
      model_family TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      credits REAL NOT NULL,
      workspace TEXT NOT NULL,
      status TEXT NOT NULL,
      cost_source TEXT NOT NULL DEFAULT 'estimated',
      source TEXT NOT NULL DEFAULT 'chat',
      request_count INTEGER NOT NULL DEFAULT 1,
      span_id TEXT
    )
  `);
}

function ensureSessionsSchema(db: Database): void {
  const names = new Set<string>();
  const result = db.exec("PRAGMA table_info(sessions)");
  if (result.length > 0) {
    for (const row of result[0].values) {
      const col = row[1];
      if (typeof col === "string") names.add(col);
    }
  }
  if (!names.has("title")) {
    db.run("ALTER TABLE sessions ADD COLUMN title TEXT");
  }
}

function ensureTurnsSchema(db: Database): void {
  const existingColumns = getTurnsColumnNames(db);
  addTurnsColumnIfMissing(existingColumns, db, "agent_name", "TEXT NOT NULL DEFAULT 'unknown'");
  addTurnsColumnIfMissing(existingColumns, db, "cache_write_tokens", "INTEGER NOT NULL DEFAULT 0");
  addTurnsColumnIfMissing(existingColumns, db, "model_family", "TEXT NOT NULL DEFAULT 'unknown'");
  addTurnsColumnIfMissing(existingColumns, db, "cost_source", "TEXT NOT NULL DEFAULT 'estimated'");
  addTurnsColumnIfMissing(existingColumns, db, "source", "TEXT NOT NULL DEFAULT 'chat'");
  addTurnsColumnIfMissing(existingColumns, db, "request_count", "INTEGER NOT NULL DEFAULT 1");
  if (existingColumns.has("span_id")) return;

  const columns = `id, session_id, timestamp, duration, agent_name, model, model_family,
    input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens,
    cost_usd, credits, workspace, status, cost_source, source, request_count`;
  db.run("BEGIN");
  try {
    db.run("ALTER TABLE turns RENAME TO legacy_turns");
    createTurnsTable(db);
    db.run(`INSERT INTO turns (${columns}) SELECT ${columns} FROM legacy_turns`);
    db.run("DROP TABLE legacy_turns");
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

function getTurnsColumnNames(db: Database): Set<string> {
  const names = new Set<string>();
  const result = db.exec("PRAGMA table_info(turns)");
  if (result.length === 0) return names;
  for (const row of result[0].values) {
    const columnName = row[1];
    if (typeof columnName === "string") {
      names.add(columnName);
    }
  }
  return names;
}

function addTurnsColumnIfMissing(existingColumns: Set<string>, db: Database, column: string, definition: string): void {
  if (existingColumns.has(column)) return;
  db.run(`ALTER TABLE turns ADD COLUMN ${column} ${definition}`);
  existingColumns.add(column);
}
