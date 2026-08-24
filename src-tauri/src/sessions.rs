use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const PROJECTION: &str = "s.id, s.parent_id, s.title, \
  COALESCE(NULLIF(p.name,''), p.worktree, ''), s.directory, \
  s.agent, s.model, s.cost, \
  s.tokens_input + s.tokens_output + s.tokens_reasoning + s.tokens_cache_read + s.tokens_cache_write, \
  s.tokens_reasoning, s.tokens_cache_read, \
  s.summary_files, s.summary_additions, s.summary_deletions, \
  s.time_created, s.time_updated, \
  (SELECT COUNT(*) FROM session c WHERE c.parent_id = s.id)";

const KEYSET: &str = "(:cursor_time IS NULL OR s.time_updated < :cursor_time \
   OR (s.time_updated = :cursor_time AND s.id < :cursor_id))";

const ORDER: &str = "ORDER BY s.time_updated DESC, s.id DESC LIMIT :limit";

/// A root counts as active when the session itself, one of its children, or one
/// of its grandchildren falls in range. opencode does not bump a parent's
/// `time_updated` when a subagent runs, so filtering roots on their own
/// timestamp silently drops conversations whose only recent work was delegated.
/// The observed tree is at most 3 levels deep, so the upward walk is unrolled
/// into two joins rather than a recursive CTE.
const ROOTS: &str = "WITH matching AS ( \
    SELECT s.id, s.parent_id FROM session s \
    WHERE s.time_updated BETWEEN :from AND :to \
      AND (:project_id IS NULL OR s.project_id = :project_id) \
      AND (:directory IS NULL OR s.directory = :directory) \
  ), roots AS ( \
    SELECT id AS root_id FROM matching WHERE parent_id IS NULL \
    UNION \
    SELECT p.id FROM matching m JOIN session p ON m.parent_id = p.id \
      WHERE p.parent_id IS NULL \
    UNION \
    SELECT gp.id FROM matching m JOIN session p ON m.parent_id = p.id \
      JOIN session gp ON p.parent_id = gp.id WHERE gp.parent_id IS NULL \
  )";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionCursor {
    pub time_updated: i64,
    pub id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub parent_id: Option<String>,
    pub profile: String,
    pub title: String,
    pub project_name: String,
    pub directory: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub cost: f64,
    pub total_tokens: i64,
    pub tokens_reasoning: i64,
    pub tokens_cache_read: i64,
    pub summary_files: Option<i64>,
    pub summary_additions: Option<i64>,
    pub summary_deletions: Option<i64>,
    pub is_subagent: bool,
    pub time_created: i64,
    pub time_updated: i64,
    pub child_count: i64,
    pub children: Vec<SessionRow>,
    pub has_more_children: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub rows: Vec<SessionRow>,
    pub next_cursor: Option<SessionCursor>,
    pub total: Option<i64>,
}

fn map_session(row: &rusqlite::Row, profile: &str) -> rusqlite::Result<SessionRow> {
    let parent_id: Option<String> = row.get(1)?;
    Ok(SessionRow {
        id: row.get(0)?,
        is_subagent: parent_id.is_some(),
        parent_id,
        profile: profile.to_string(),
        title: row.get(2)?,
        project_name: row.get(3)?,
        directory: row.get(4)?,
        agent: row.get(5)?,
        model: row.get(6)?,
        cost: row.get(7)?,
        total_tokens: row.get(8)?,
        tokens_reasoning: row.get(9)?,
        tokens_cache_read: row.get(10)?,
        summary_files: row.get(11)?,
        summary_additions: row.get(12)?,
        summary_deletions: row.get(13)?,
        time_created: row.get(14)?,
        time_updated: row.get(15)?,
        child_count: row.get(16)?,
        children: Vec::new(),
        has_more_children: false,
    })
}

/// `dir:<path>` project ids are synthetic: opencode stores those sessions under
/// the shared `global` project and only the directory distinguishes them.
fn project_params(project: Option<&str>) -> (Option<String>, Option<String>) {
    match project {
        None => (None, None),
        Some(id) => match id.strip_prefix("dir:") {
            Some(directory) => (Some("global".to_string()), Some(directory.to_string())),
            None => (Some(id.to_string()), None),
        },
    }
}

fn next_cursor(rows: &[SessionRow], limit: i64) -> Option<SessionCursor> {
    if (rows.len() as i64) < limit {
        return None;
    }
    rows.last().map(|row| SessionCursor {
        time_updated: row.time_updated,
        id: row.id.clone(),
    })
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn load_children(
    conn: &Connection,
    profile: &str,
    parent_ids: &[String],
    per_parent: i64,
) -> Result<Vec<SessionRow>, String> {
    if parent_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; parent_ids.len()].join(",");
    let sql = format!(
        "SELECT * FROM ( \
           SELECT {PROJECTION}, ROW_NUMBER() OVER ( \
             PARTITION BY s.parent_id ORDER BY s.time_updated DESC, s.id DESC \
           ) AS rn \
           FROM session s LEFT JOIN project p ON s.project_id = p.id \
           WHERE s.parent_id IN ({placeholders}) \
         ) WHERE rn <= ?{}",
        parent_ids.len() + 1
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = parent_ids
        .iter()
        .map(|id| Box::new(id.clone()) as Box<dyn rusqlite::ToSql>)
        .collect();
    params.push(Box::new(per_parent));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| map_session(row, profile),
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn roots(
    conn: &Connection,
    profile: &str,
    from: i64,
    to: i64,
    project: Option<&str>,
    cursor: Option<&SessionCursor>,
    limit: i64,
    inline_children: i64,
) -> Result<SessionPage, String> {
    let (project_id, directory) = project_params(project);
    let (cursor_time, cursor_id) = match cursor {
        Some(c) => (Some(c.time_updated), Some(c.id.clone())),
        None => (None, None),
    };

    let sql = format!(
        "{ROOTS} SELECT {PROJECTION} FROM session s \
         JOIN roots r ON r.root_id = s.id \
         LEFT JOIN project p ON s.project_id = p.id \
         WHERE {KEYSET} {ORDER}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            rusqlite::named_params! {
                ":from": from,
                ":to": to,
                ":project_id": project_id,
                ":directory": directory,
                ":cursor_time": cursor_time,
                ":cursor_id": cursor_id,
                ":limit": limit,
            },
            |row| map_session(row, profile),
        )
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<SessionRow> = mapped
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let parent_ids: Vec<String> = rows
        .iter()
        .filter(|row| row.child_count > 0)
        .map(|row| row.id.clone())
        .collect();
    let children = load_children(conn, profile, &parent_ids, inline_children)?;
    for child in children {
        if let Some(parent) = child
            .parent_id
            .clone()
            .and_then(|id| rows.iter_mut().find(|row| row.id == id))
        {
            parent.children.push(child);
        }
    }
    for row in &mut rows {
        row.has_more_children = row.child_count > row.children.len() as i64;
    }

    let total = conn
        .query_row(
            &format!("{ROOTS} SELECT COUNT(*) FROM roots"),
            rusqlite::named_params! {
                ":from": from,
                ":to": to,
                ":project_id": project_params(project).0,
                ":directory": project_params(project).1,
            },
            |r| r.get::<_, i64>(0),
        )
        .ok();

    let next = next_cursor(&rows, limit);
    Ok(SessionPage {
        rows,
        next_cursor: next,
        total,
    })
}

pub fn children(
    conn: &Connection,
    profile: &str,
    parent_id: &str,
    cursor: Option<&SessionCursor>,
    limit: i64,
) -> Result<SessionPage, String> {
    let (cursor_time, cursor_id) = match cursor {
        Some(c) => (Some(c.time_updated), Some(c.id.clone())),
        None => (None, None),
    };
    let sql = format!(
        "SELECT {PROJECTION} FROM session s \
         LEFT JOIN project p ON s.project_id = p.id \
         WHERE s.parent_id = :parent_id AND {KEYSET} {ORDER}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            rusqlite::named_params! {
                ":parent_id": parent_id,
                ":cursor_time": cursor_time,
                ":cursor_id": cursor_id,
                ":limit": limit,
            },
            |row| map_session(row, profile),
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<SessionRow> = mapped
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let next = next_cursor(&rows, limit);
    Ok(SessionPage {
        rows,
        next_cursor: next,
        total: None,
    })
}

pub fn search(
    conn: &Connection,
    profile: &str,
    from: i64,
    to: i64,
    project: Option<&str>,
    query: &str,
    cursor: Option<&SessionCursor>,
    limit: i64,
) -> Result<SessionPage, String> {
    let (project_id, directory) = project_params(project);
    let (cursor_time, cursor_id) = match cursor {
        Some(c) => (Some(c.time_updated), Some(c.id.clone())),
        None => (None, None),
    };
    let sql = format!(
        "SELECT {PROJECTION} FROM session s \
         LEFT JOIN project p ON s.project_id = p.id \
         WHERE s.time_updated BETWEEN :from AND :to \
           AND (:project_id IS NULL OR s.project_id = :project_id) \
           AND (:directory IS NULL OR s.directory = :directory) \
           AND (s.title LIKE :q ESCAPE '\\' OR s.agent LIKE :q ESCAPE '\\' \
                OR COALESCE(NULLIF(p.name,''), p.worktree, '') LIKE :q ESCAPE '\\') \
           AND {KEYSET} {ORDER}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            rusqlite::named_params! {
                ":from": from,
                ":to": to,
                ":project_id": project_id,
                ":directory": directory,
                ":q": like_pattern(query),
                ":cursor_time": cursor_time,
                ":cursor_id": cursor_id,
                ":limit": limit,
            },
            |row| map_session(row, profile),
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<SessionRow> = mapped
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    let next = next_cursor(&rows, limit);
    Ok(SessionPage {
        rows,
        next_cursor: next,
        total: None,
    })
}
