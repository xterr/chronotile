pub mod ingest;
pub mod migrations;
pub mod read;

use migrations::FACT_TABLES;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub path: String,
    pub building: bool,
    pub progress_rows: u64,
    pub time_refreshed: Option<i64>,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub refreshing: bool,
    pub ingest_epoch: u64,
    pub sources: Vec<SourceStatus>,
}

pub struct CacheManager {
    pub cache_path: PathBuf,
    pub ingest_lock: tokio::sync::Mutex<()>,
    pub interrupt: AtomicBool,
    pub refreshing: AtomicBool,
    pub ingest_epoch: AtomicU64,
    pub building: Mutex<HashMap<String, u64>>,
}

impl CacheManager {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let cache_path = data_dir.join("cache.db");
        let manager = Self {
            cache_path,
            ingest_lock: tokio::sync::Mutex::new(()),
            interrupt: AtomicBool::new(false),
            refreshing: AtomicBool::new(false),
            ingest_epoch: AtomicU64::new(0),
            building: Mutex::new(HashMap::new()),
        };
        let conn = manager.open()?;
        migrations::run(&conn)?;
        Ok(manager)
    }

    pub fn open(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.cache_path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    pub fn sync_prices(&self, conn: &Connection, catalog: &crate::pricing::Catalog) -> Result<(), String> {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM model_price", [])
            .map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO model_price (provider, model_id, input, output, cache_read, cache_write, context) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(provider, model_id) DO UPDATE SET \
                     input = excluded.input, output = excluded.output, cache_read = excluded.cache_read, \
                     cache_write = excluded.cache_write, context = excluded.context",
                )
                .map_err(|e| e.to_string())?;
            for price in &catalog.models {
                stmt.execute(rusqlite::params![
                    price.provider,
                    price.model,
                    price.input,
                    price.output,
                    price.cache_read,
                    price.cache_write,
                    price.context,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// Rebuilds the derived agent dimension from whatever raw names the facts
    /// currently hold. Cheap enough to run on every startup (a database with
    /// 133k messages has ~50 distinct agents), which keeps the mapping correct
    /// after an ingest without the facts themselves ever being rewritten.
    pub fn sync_agents(&self, conn: &Connection) -> Result<(), String> {
        let raw: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT DISTINCT source_id, agent FROM fact_messages")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO agent_dim (source_id, agent_raw, agent_key, display) \
                     VALUES (?1,?2,?3,?4) ON CONFLICT(source_id, agent_raw) DO UPDATE SET \
                     agent_key = excluded.agent_key, display = excluded.display",
                )
                .map_err(|e| e.to_string())?;
            for (source_id, agent) in &raw {
                stmt.execute(rusqlite::params![
                    source_id,
                    agent,
                    crate::agents::normalize_key(agent),
                    crate::agents::clean_display(agent),
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn source_id(&self, conn: &Connection, path: &str) -> Result<i64, String> {
        conn.execute(
            "INSERT INTO source (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
            [path],
        )
        .map_err(|e| e.to_string())?;
        conn.query_row("SELECT id FROM source WHERE path = ?1", [path], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())
    }

    pub fn remove_source(&self, path: &str) -> Result<(), String> {
        let conn = self.open()?;
        let id: Option<i64> = conn
            .query_row("SELECT id FROM source WHERE path = ?1", [path], |r| {
                r.get(0)
            })
            .ok();
        if let Some(id) = id {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for table in FACT_TABLES {
                tx.execute(&format!("DELETE FROM {table} WHERE source_id = ?1"), [id])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM source WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn wipe_source(&self, conn: &Connection, source_id: i64) -> Result<(), String> {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for table in FACT_TABLES {
            tx.execute(
                &format!("DELETE FROM {table} WHERE source_id = ?1"),
                [source_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "UPDATE source SET msg_watermark = 0, part_watermark = 0, msg_scanned = 0, part_scanned = 0 WHERE id = ?1",
            [source_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn status(&self, known_paths: &[String]) -> CacheStatus {
        let building = self.building.lock().expect("building lock");
        let refreshed: HashMap<String, i64> = self
            .open()
            .ok()
            .and_then(|conn| {
                let mut stmt = conn
                    .prepare("SELECT path, time_refreshed FROM source")
                    .ok()?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
                    })
                    .ok()?;
                Some(
                    rows.filter_map(|r| r.ok())
                        .filter_map(|(p, t)| t.map(|t| (p, t)))
                        .collect(),
                )
            })
            .unwrap_or_default();
        CacheStatus {
            refreshing: self.refreshing.load(Ordering::SeqCst),
            ingest_epoch: self.ingest_epoch.load(Ordering::SeqCst),
            sources: known_paths
                .iter()
                .map(|path| SourceStatus {
                    path: path.clone(),
                    building: building.contains_key(path),
                    progress_rows: building.get(path).copied().unwrap_or(0),
                    time_refreshed: refreshed.get(path).copied(),
                })
                .collect(),
        }
    }
}
