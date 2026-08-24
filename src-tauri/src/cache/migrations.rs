use rusqlite::Connection;

pub struct Migration {
    pub version: i64,
    pub sql: &'static str,
    pub rebuild: bool,
}

const BASELINE_V1: &str = "
CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  msg_watermark TEXT NOT NULL DEFAULT '',
  part_watermark TEXT NOT NULL DEFAULT '',
  msg_scanned INTEGER NOT NULL DEFAULT 0,
  part_scanned INTEGER NOT NULL DEFAULT 0,
  time_refreshed INTEGER
);
CREATE TABLE IF NOT EXISTS fact_messages (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  session_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  agent TEXT NOT NULL,
  project_id TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  tok_input INTEGER NOT NULL DEFAULT 0,
  tok_output INTEGER NOT NULL DEFAULT 0,
  tok_reasoning INTEGER NOT NULL DEFAULT 0,
  tok_cache_read INTEGER NOT NULL DEFAULT 0,
  tok_cache_write INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0,
  min_ts INTEGER NOT NULL,
  max_ts INTEGER NOT NULL,
  PRIMARY KEY (source_id, day, session_id, model_key, agent)
);
CREATE TABLE IF NOT EXISTS fact_prompts (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day)
);
CREATE TABLE IF NOT EXISTS fact_hourly (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, hour)
);
CREATE TABLE IF NOT EXISTS fact_tools (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, tool)
);
CREATE TABLE IF NOT EXISTS fact_events (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, kind)
);
CREATE TABLE IF NOT EXISTS tool_durations (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  duration_ms REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_durations_idx ON tool_durations (source_id, day);
CREATE TABLE IF NOT EXISTS rate_samples (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  model_key TEXT NOT NULL,
  tps REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_samples_idx ON rate_samples (source_id, day);
CREATE TABLE IF NOT EXISTS project_dim (
  source_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  worktree TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_id, project_id)
);
CREATE TABLE IF NOT EXISTS pending (
  source_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  PRIMARY KEY (source_id, kind, id)
);
";

/// Forward-only migrations, applied in order at startup. Append new entries
/// with increasing versions; never edit or remove released entries. Set
/// `rebuild: true` when ingest semantics change so facts are wiped and
/// watermarks reset, forcing a full re-ingest with the new logic.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: BASELINE_V1,
        rebuild: false,
    },
    Migration {
        version: 2,
        sql: "-- v2: sessions in the 'global' project are re-attributed to synthetic per-directory projects (dir:<path>); requires full re-ingest",
        rebuild: true,
    },
    Migration {
        version: 3,
        sql: V3_PROJECT_DIMENSION,
        rebuild: true,
    },
    Migration {
        version: 4,
        sql: V4_MODEL_DIMENSIONS,
        rebuild: true,
    },
    Migration {
        version: 5,
        sql: V5_ROWID_WATERMARKS,
        rebuild: true,
    },
    Migration {
        version: 6,
        sql: V6_SKILL_FACTS,
        rebuild: true,
    },
];

/// v3: adds the project dimension to all part/prompt-derived facts so every
/// dashboard metric can be filtered by project. Primary keys change, so the
/// tables are recreated and data re-ingested.
const V3_PROJECT_DIMENSION: &str = "
DROP TABLE IF EXISTS fact_prompts;
DROP TABLE IF EXISTS fact_hourly;
DROP TABLE IF EXISTS fact_tools;
DROP TABLE IF EXISTS fact_events;
DROP TABLE IF EXISTS tool_durations;
DROP TABLE IF EXISTS rate_samples;
CREATE TABLE fact_prompts (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  project_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, project_id)
);
CREATE TABLE fact_hourly (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, hour, project_id)
);
CREATE TABLE fact_tools (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  project_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, tool, project_id)
);
CREATE TABLE fact_events (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day, kind, project_id)
);
CREATE TABLE tool_durations (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  project_id TEXT NOT NULL,
  duration_ms REAL NOT NULL
);
CREATE INDEX tool_durations_idx ON tool_durations (source_id, day);
CREATE TABLE rate_samples (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  model_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tps REAL NOT NULL
);
CREATE INDEX rate_samples_idx ON rate_samples (source_id, day);
";

/// v4: splits the composite model key into separate provider, model and
/// variant dimensions on message facts and rate samples, so model stats can
/// be broken down (and later filtered) by provider and by reasoning-effort
/// variant. Primary keys change, so the tables are recreated and data
/// re-ingested.
const V4_MODEL_DIMENSIONS: &str = "
DROP TABLE IF EXISTS fact_messages;
DROP TABLE IF EXISTS rate_samples;
CREATE TABLE fact_messages (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL,
  project_id TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  tok_input INTEGER NOT NULL DEFAULT 0,
  tok_output INTEGER NOT NULL DEFAULT 0,
  tok_reasoning INTEGER NOT NULL DEFAULT 0,
  tok_cache_read INTEGER NOT NULL DEFAULT 0,
  tok_cache_write INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0,
  min_ts INTEGER NOT NULL,
  max_ts INTEGER NOT NULL,
  PRIMARY KEY (source_id, day, session_id, provider, model_id, variant, agent)
);
CREATE TABLE rate_samples (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL,
  tps REAL NOT NULL
);
CREATE INDEX rate_samples_idx ON rate_samples (source_id, day);
";

/// v5: opencode's message and part ids are not monotonic with insertion order
/// (measured: 2 of 145k rows agree between id-rank and time-rank), so an
/// id-keyed watermark both skipped new rows and made the deletion sentinel
/// mismatch on every cycle, forcing a full re-ingest on each refresh. SQLite
/// assigns rowid in insertion order, which is the property the incremental
/// scan actually needs. Watermarks change type, so the table is recreated and
/// the sources are re-ingested once.
const V5_ROWID_WATERMARKS: &str = "
CREATE TABLE source_v5 (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  msg_watermark INTEGER NOT NULL DEFAULT 0,
  part_watermark INTEGER NOT NULL DEFAULT 0,
  msg_scanned INTEGER NOT NULL DEFAULT 0,
  part_scanned INTEGER NOT NULL DEFAULT 0,
  time_refreshed INTEGER
);
INSERT INTO source_v5 (id, path, time_refreshed) SELECT id, path, time_refreshed FROM source;
DROP TABLE source;
ALTER TABLE source_v5 RENAME TO source;
";

/// v6: skills are not a first-class entity in opencode's schema — a skill use is
/// recorded inside a tool call's input: `task` carries a `load_skills` array of
/// preloaded skills, and the `skill` tool carries the single `name` it invoked.
/// This projects both into a day-grain fact so the Skills page can rank usage.
/// `skill_mcp` is deliberately excluded: its `mcp_name` names an MCP server
/// bundled with a skill, not the skill itself. Ingest semantics change, so the
/// sources are re-ingested once.
const V6_SKILL_FACTS: &str = "
CREATE TABLE fact_skills (
  source_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  skill TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  via_task INTEGER NOT NULL DEFAULT 0,
  direct INTEGER NOT NULL DEFAULT 0,
  min_ts INTEGER NOT NULL,
  max_ts INTEGER NOT NULL,
  PRIMARY KEY (source_id, day, skill, session_id, project_id)
);
CREATE INDEX fact_skills_idx ON fact_skills (source_id, day);
";

pub const FACT_TABLES: [&str; 10] = [
    "fact_messages",
    "fact_prompts",
    "fact_hourly",
    "fact_tools",
    "fact_skills",
    "fact_events",
    "tool_durations",
    "rate_samples",
    "project_dim",
    "pending",
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

fn current_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT value FROM meta WHERE key = 'schema_version'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(0)
}

fn drop_everything(conn: &Connection) -> Result<(), String> {
    let tables: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    for table in tables {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{table}\""))
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .map_err(|e| e.to_string())
}

fn wipe_facts(conn: &Connection) -> Result<(), String> {
    for table in FACT_TABLES {
        conn.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE source SET msg_watermark = 0, part_watermark = 0, msg_scanned = 0, part_scanned = 0",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .map_err(|e| e.to_string())?;

    let mut version = current_version(conn);
    if version > latest_version() {
        log::warn!(
            "cache schema version {version} is newer than supported {}; rebuilding cache",
            latest_version()
        );
        drop_everything(conn)?;
        version = 0;
    }

    for migration in MIGRATIONS.iter().filter(|m| m.version > version) {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(migration.sql)
            .map_err(|e| format!("migration {} failed: {e}", migration.version))?;
        if migration.rebuild {
            wipe_facts(&tx)?;
        }
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [migration.version.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        log::info!("cache migrated to schema version {}", migration.version);
    }
    Ok(())
}
