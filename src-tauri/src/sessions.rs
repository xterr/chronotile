use crate::stats::Range;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
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
}

pub fn sessions_list(
    conn: &Connection,
    profile: &str,
    range: Range,
    include_subagents: bool,
    project: Option<&str>,
    acc: &mut Vec<SessionRow>,
) -> Result<(), String> {
    let parent_filter = if include_subagents {
        ""
    } else {
        "AND s.parent_id IS NULL"
    };
    let project_filter = match project {
        Some(id) => match id.strip_prefix("dir:") {
            Some(_) => "AND s.project_id = 'global' AND s.directory = ?3",
            None => "AND s.project_id = ?3",
        },
        None => "",
    };
    let sql = format!(
        "SELECT s.id, s.title, COALESCE(NULLIF(p.name,''), p.worktree, ''), s.directory, \
         s.agent, s.model, s.cost, \
         s.tokens_input + s.tokens_output + s.tokens_reasoning + s.tokens_cache_read + s.tokens_cache_write, \
         s.tokens_reasoning, s.tokens_cache_read, \
         s.summary_files, s.summary_additions, s.summary_deletions, \
         s.parent_id IS NOT NULL, s.time_created, s.time_updated \
         FROM session s LEFT JOIN project p ON s.project_id = p.id \
         WHERE s.time_updated BETWEEN ?1 AND ?2 {parent_filter} {project_filter} \
         ORDER BY s.time_updated DESC"
    );
    let project_param = project.map(|id| id.strip_prefix("dir:").unwrap_or(id).to_string());
    let params: Vec<Box<dyn rusqlite::ToSql>> = match &project_param {
        Some(value) => vec![
            Box::new(range.from),
            Box::new(range.to),
            Box::new(value.clone()),
        ],
        None => vec![Box::new(range.from), Box::new(range.to)],
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |row| {
            Ok(SessionRow {
                id: row.get(0)?,
                profile: profile.to_string(),
                title: row.get(1)?,
                project_name: row.get(2)?,
                directory: row.get(3)?,
                agent: row.get(4)?,
                model: row.get(5)?,
                cost: row.get(6)?,
                total_tokens: row.get(7)?,
                tokens_reasoning: row.get(8)?,
                tokens_cache_read: row.get(9)?,
                summary_files: row.get(10)?,
                summary_additions: row.get(11)?,
                summary_deletions: row.get(12)?,
                is_subagent: row.get(13)?,
                time_created: row.get(14)?,
                time_updated: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        acc.push(row.map_err(|e| e.to_string())?);
    }
    Ok(())
}
