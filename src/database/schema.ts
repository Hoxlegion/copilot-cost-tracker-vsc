import type { Database } from "sql.js";

export function createTables(db: Database): void {
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
      UNIQUE(session_id, timestamp, model)
    )
  `);

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

  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_workspace ON turns(workspace)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model_family)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_name)`);
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
