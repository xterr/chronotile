use crate::parts::{ErrorStat, ReliabilityReport, ToolStat};
use crate::stats::{
    percentile, DailyPoint, GroupStat, HourlyCell, ModelDailyPoint, Overview, ProjectStat,
    TokenTotals,
};
use chrono::{Local, TimeZone};
use rusqlite::Connection;
use std::collections::HashMap;

fn ms_to_day(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

pub fn day_bounds(from: Option<i64>, to: Option<i64>) -> (String, String) {
    (
        from.map(ms_to_day).unwrap_or_else(|| "0000-01-01".to_string()),
        to.map(ms_to_day).unwrap_or_else(|| "9999-12-31".to_string()),
    )
}

pub fn resolve_source(conn: &Connection, path: &str) -> Option<i64> {
    conn.query_row("SELECT id FROM source WHERE path = ?1", [path], |r| {
        r.get(0)
    })
    .ok()
}

type DayParams<'a> = (i64, &'a str, &'a str, Option<&'a str>);

fn read_tokens(row: &rusqlite::Row, offset: usize) -> rusqlite::Result<(f64, TokenTotals)> {
    Ok((
        row.get(offset)?,
        TokenTotals {
            input: row.get(offset + 1)?,
            output: row.get(offset + 2)?,
            reasoning: row.get(offset + 3)?,
            cache_read: row.get(offset + 4)?,
            cache_write: row.get(offset + 5)?,
        },
    ))
}

const FACT_SUMS: &str = "COALESCE(SUM(cost),0), COALESCE(SUM(tok_input),0), \
    COALESCE(SUM(tok_output),0), COALESCE(SUM(tok_reasoning),0), \
    COALESCE(SUM(tok_cache_read),0), COALESCE(SUM(tok_cache_write),0)";

pub fn overview(conn: &Connection, params: DayParams) -> Result<Overview, String> {
    let mut acc = conn
        .query_row(
            &format!(
                "SELECT {FACT_SUMS}, COALESCE(SUM(msgs),0), COUNT(DISTINCT session_id), \
                 COUNT(DISTINCT model_key), COUNT(DISTINCT day) \
                 FROM fact_messages WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)"
            ),
            params,
            |row| {
                let (cost, tokens) = read_tokens(row, 0)?;
                Ok(Overview {
                    cost,
                    tokens,
                    messages: row.get(6)?,
                    sessions: row.get(7)?,
                    models_used: row.get(8)?,
                    active_days: row.get(9)?,
                    ..Default::default()
                })
            },
        )
        .map_err(|e| e.to_string())?;
    acc.prompts = conn
        .query_row(
            "SELECT COALESCE(SUM(count),0) FROM fact_prompts WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)",
            params,
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    acc.tool_calls = conn
        .query_row(
            "SELECT COALESCE(SUM(calls),0) FROM fact_tools WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)",
            params,
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(acc)
}

pub fn daily_series(conn: &Connection, params: DayParams) -> Result<Vec<DailyPoint>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT day, {FACT_SUMS}, COALESCE(SUM(msgs),0), COUNT(DISTINCT session_id) \
             FROM fact_messages WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY day ORDER BY day"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let day: String = row.get(0)?;
            let (cost, tokens) = read_tokens(row, 1)?;
            Ok(DailyPoint {
                date: day,
                cost,
                tokens,
                messages: row.get(7)?,
                sessions: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn group_stats(
    conn: &Connection,
    params: DayParams,
    by_agent: bool,
) -> Result<Vec<GroupStat>, String> {
    let key = if by_agent { "agent" } else { "model_key" };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {key}, {FACT_SUMS}, COALESCE(SUM(msgs),0), COUNT(DISTINCT session_id), \
             MIN(min_ts), MAX(max_ts) \
             FROM fact_messages WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) GROUP BY {key}"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let (cost, tokens) = read_tokens(row, 1)?;
            Ok(GroupStat {
                key: row.get(0)?,
                cost,
                tokens,
                messages: row.get(7)?,
                sessions: row.get(8)?,
                first_used: row.get(9)?,
                last_used: row.get(10)?,
                p50_output_tps: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<GroupStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    if !by_agent {
        let mut rates: HashMap<String, Vec<f64>> = HashMap::new();
        let mut stmt = conn
            .prepare(
                "SELECT model_key, tps FROM rate_samples WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)",
            )
            .map_err(|e| e.to_string())?;
        let samples = stmt
            .query_map(params, |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for sample in samples {
            let (key, tps) = sample.map_err(|e| e.to_string())?;
            rates.entry(key).or_default().push(tps);
        }
        for stat in &mut out {
            if let Some(values) = rates.get_mut(&stat.key) {
                values.sort_by(|a, b| a.total_cmp(b));
                stat.p50_output_tps = percentile(values, 0.5);
            }
        }
    }
    out.sort_by(|a, b| b.cost.total_cmp(&a.cost));
    Ok(out)
}

pub fn group_daily(
    conn: &Connection,
    params: DayParams,
    by_agent: bool,
) -> Result<Vec<ModelDailyPoint>, String> {
    let key = if by_agent { "agent" } else { "model_key" };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT day, {key}, COALESCE(SUM(cost),0), \
             COALESCE(SUM(tok_input + tok_output + tok_reasoning + tok_cache_read + tok_cache_write),0) \
             FROM fact_messages WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY day, {key} ORDER BY day"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            Ok(ModelDailyPoint {
                date: row.get(0)?,
                key: row.get(1)?,
                cost: row.get(2)?,
                total_tokens: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn project_stats(conn: &Connection, params: DayParams) -> Result<Vec<ProjectStat>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT f.project_id, COALESCE(p.name,''), COALESCE(p.worktree,''), {FACT_SUMS}, \
             COALESCE(SUM(msgs),0), COUNT(DISTINCT session_id) \
             FROM fact_messages f LEFT JOIN project_dim p \
             ON p.source_id = f.source_id AND p.project_id = f.project_id \
             WHERE f.source_id = ?1 AND f.day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR f.project_id = ?4) GROUP BY f.project_id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let (cost, tokens) = read_tokens(row, 3)?;
            Ok(ProjectStat {
                project_id: row.get(0)?,
                name: row.get(1)?,
                worktree: row.get(2)?,
                cost,
                tokens,
                messages: row.get(9)?,
                sessions: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<ProjectStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    out.sort_by(|a, b| b.cost.total_cmp(&a.cost));
    Ok(out)
}

pub fn hourly_activity(conn: &Connection, params: DayParams) -> Result<Vec<HourlyCell>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT CAST(strftime('%w', day) AS INTEGER), hour, SUM(count) \
             FROM fact_hourly WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY 1, 2 ORDER BY 1, 2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            Ok(HourlyCell {
                weekday: row.get(0)?,
                hour: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn tool_stats(conn: &Connection, params: DayParams) -> Result<Vec<ToolStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT tool, SUM(calls), SUM(completed), SUM(errors), SUM(total_duration_ms) \
             FROM fact_tools WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) GROUP BY tool",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            Ok(ToolStat {
                tool: row.get(0)?,
                calls: row.get(1)?,
                completed: row.get(2)?,
                errors: row.get(3)?,
                total_duration_ms: row.get(4)?,
                p50_duration_ms: None,
                p95_duration_ms: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<ToolStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let mut durations: HashMap<String, Vec<f64>> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT tool, duration_ms FROM tool_durations WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)",
        )
        .map_err(|e| e.to_string())?;
    let samples = stmt
        .query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
        .map_err(|e| e.to_string())?;
    for sample in samples {
        let (tool, duration) = sample.map_err(|e| e.to_string())?;
        durations.entry(tool).or_default().push(duration);
    }
    for stat in &mut out {
        if let Some(values) = durations.get_mut(&stat.tool) {
            values.sort_by(|a, b| a.total_cmp(b));
            stat.p50_duration_ms = percentile(values, 0.5);
            stat.p95_duration_ms = percentile(values, 0.95);
        }
    }
    out.sort_by(|a, b| b.calls.cmp(&a.calls));
    Ok(out)
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOption {
    pub project_id: String,
    pub name: String,
    pub worktree: String,
}

pub fn list_projects(conn: &Connection, source_id: i64) -> Result<Vec<ProjectOption>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.project_id, COALESCE(p.name,''), COALESCE(p.worktree,'') \
             FROM fact_messages f LEFT JOIN project_dim p \
             ON p.source_id = f.source_id AND p.project_id = f.project_id \
             WHERE f.source_id = ?1 ORDER BY 3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source_id], |row| {
            Ok(ProjectOption {
                project_id: row.get(0)?,
                name: row.get(1)?,
                worktree: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn reliability(conn: &Connection, params: DayParams) -> Result<ReliabilityReport, String> {
    let mut report = ReliabilityReport::default();
    let mut stmt = conn
        .prepare(
            "SELECT kind, SUM(count) FROM fact_events \
             WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) GROUP BY kind",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (kind, count) = row.map_err(|e| e.to_string())?;
        match kind.as_str() {
            "compaction_auto" => report.compactions_auto = count,
            "compaction_manual" => report.compactions_manual = count,
            "compaction_overflow" => report.compactions_overflow = count,
            "retry" => report.retries = count,
            other => {
                if let Some(name) = other.strip_prefix("error:") {
                    report.errors.push(ErrorStat {
                        name: name.to_string(),
                        count,
                    });
                }
            }
        }
    }
    report.errors.sort_by(|a, b| b.count.cmp(&a.count));
    Ok(report)
}
