use crate::parts::{ErrorStat, ReliabilityReport, SkillStat, ToolStat};
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

struct Money {
    reported: f64,
    estimated: f64,
}

fn read_money(row: &rusqlite::Row, offset: usize) -> rusqlite::Result<(Money, TokenTotals)> {
    Ok((
        Money {
            reported: row.get(offset)?,
            estimated: row.get(offset + 1)?,
        },
        TokenTotals {
            input: row.get(offset + 2)?,
            output: row.get(offset + 3)?,
            reasoning: row.get(offset + 4)?,
            cache_read: row.get(offset + 5)?,
            cache_write: row.get(offset + 6)?,
        },
    ))
}

/// Reasoning tokens are deliberately excluded: opencode already counts them
/// inside `tok_output`, and including them again overstates every model whose
/// variant enables thinking. Recomputing metered rows without them reproduces
/// opencode's own reported totals to the cent, which is the invariant that makes
/// the estimate comparable to the reported figure.
const COST_EST: &str = "COALESCE(SUM((f.tok_input * COALESCE(p.input,0) \
    + f.tok_output * COALESCE(p.output,0) \
    + f.tok_cache_read * COALESCE(p.cache_read,0) \
    + f.tok_cache_write * COALESCE(p.cache_write,0)) / 1000000.0),0)";

/// What prompt caching is worth: every cache-read token would otherwise have
/// been billed as fresh input, while every cache-write token carries a premium
/// over plain input. Netting the two is the only honest figure — quoting the
/// read saving alone would ignore what the cache cost to fill.
const CACHE_SAVINGS: &str = "COALESCE(SUM( \
    f.tok_cache_read * (COALESCE(p.input,0) - COALESCE(p.cache_read,0)) \
    - f.tok_cache_write * (COALESCE(p.cache_write,0) - COALESCE(p.input,0)) \
    ) / 1000000.0, 0)";

/// Prices join on the model dimension, so an unpriced model contributes zero to
/// the estimate rather than dropping its tokens from the aggregate entirely.
const FACT_FROM: &str = "FROM fact_messages f LEFT JOIN model_price p \
    ON p.provider = f.provider AND p.model_id = f.model_id";

const FACT_WHERE: &str = "WHERE f.source_id = ?1 AND f.day BETWEEN ?2 AND ?3 \
    AND (?4 IS NULL OR f.project_id = ?4)";

fn fact_sums() -> String {
    format!(
        "COALESCE(SUM(f.cost),0), {COST_EST}, COALESCE(SUM(f.tok_input),0), \
         COALESCE(SUM(f.tok_output),0), COALESCE(SUM(f.tok_reasoning),0), \
         COALESCE(SUM(f.tok_cache_read),0), COALESCE(SUM(f.tok_cache_write),0)"
    )
}

pub fn overview(conn: &Connection, params: DayParams) -> Result<Overview, String> {
    let mut acc = conn
        .query_row(
            &format!(
                "SELECT {sums}, COALESCE(SUM(f.msgs),0), COUNT(DISTINCT f.session_id), \
                 COUNT(DISTINCT f.provider || '/' || f.model_id), COUNT(DISTINCT f.day), \
                 {CACHE_SAVINGS} {FACT_FROM} {FACT_WHERE}",
                sums = fact_sums()
            ),
            params,
            |row| {
                let (cost, tokens) = read_money(row, 0)?;
                Ok(Overview {
                    cost: cost.reported,
                    cost_estimated: cost.estimated,
                    tokens,
                    messages: row.get(7)?,
                    sessions: row.get(8)?,
                    models_used: row.get(9)?,
                    active_days: row.get(10)?,
                    cache_savings: row.get(11)?,
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
            "SELECT f.day, {sums}, COALESCE(SUM(f.msgs),0), COUNT(DISTINCT f.session_id) \
             {FACT_FROM} {FACT_WHERE} GROUP BY f.day ORDER BY f.day",
            sums = fact_sums()
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let day: String = row.get(0)?;
            let (cost, tokens) = read_money(row, 1)?;
            Ok(DailyPoint {
                date: day,
                cost: cost.reported,
                cost_estimated: cost.estimated,
                tokens,
                messages: row.get(8)?,
                sessions: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Ranks by whichever cost is actually populated: reported is zero for every
/// subscription message, estimated is zero for models the catalog cannot price,
/// so ordering on either column alone buries real usage at the bottom.
fn rank(reported: f64, estimated: f64) -> f64 {
    reported.max(estimated)
}

fn median(values: &mut [f64]) -> Option<f64> {
    values.sort_by(|a, b| a.total_cmp(b));
    percentile(values, 0.5)
}

/// Label to show for each canonical agent key. Taken from the most recently
/// used spelling, so an agent that has been renamed appears under its current
/// name rather than whichever variant happens to sort first.
fn agent_display(conn: &Connection, source_id: i64) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT d.agent_raw, d.agent_key, d.display, COALESCE(MAX(f.max_ts), 0) \
             FROM agent_dim d LEFT JOIN fact_messages f \
             ON f.source_id = d.source_id AND f.agent = d.agent_raw \
             WHERE d.source_id = ?1 GROUP BY d.agent_raw ORDER BY 4",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut labels: HashMap<String, String> = HashMap::new();
    // Ordered oldest-first, so later rows overwrite and the newest spelling wins.
    for row in rows {
        let (_raw, auto_key, display) = row.map_err(|e| e.to_string())?;
        labels.insert(auto_key, display);
    }
    Ok(labels)
}

/// Resolves a raw agent name to its canonical identity. Grouping has to happen
/// in SQL rather than by folding rows afterwards: `sessions` is a
/// COUNT(DISTINCT session_id), and distinct counts cannot be combined after
/// aggregation — summing them double-counts a session that used two spellings
/// of the same agent, and taking the larger undercounts when the spellings
/// appear in different sessions. Only SQLite can count the merged group.
const AGENT_JOIN: &str = "LEFT JOIN agent_dim ad \
    ON ad.source_id = f.source_id AND ad.agent_raw = f.agent";

const AGENT_CANONICAL: &str = "COALESCE(ad.agent_key, f.agent)";

fn agent_stats(
    conn: &Connection,
    params: DayParams,
    normalize: bool,
) -> Result<Vec<GroupStat>, String> {
    let (key, join) = if normalize {
        (AGENT_CANONICAL, AGENT_JOIN)
    } else {
        ("f.agent", "")
    };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {key}, {sums}, COALESCE(SUM(f.msgs),0), COUNT(DISTINCT f.session_id), \
             MIN(f.min_ts), MAX(f.max_ts) \
             {FACT_FROM} {join} {FACT_WHERE} GROUP BY {key}",
            sums = fact_sums()
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let (cost, tokens) = read_money(row, 1)?;
            Ok(GroupStat {
                key: row.get(0)?,
                cost: cost.reported,
                cost_estimated: cost.estimated,
                tokens,
                messages: row.get(8)?,
                sessions: row.get(9)?,
                first_used: row.get(10)?,
                last_used: row.get(11)?,
                ..Default::default()
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<GroupStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    if normalize {
        let labels = agent_display(conn, params.0)?;
        for row in &mut out {
            if let Some(display) = labels.get(&row.key) {
                row.key = display.clone();
            }
        }
    }
    out.sort_by(|a, b| rank(b.cost, b.cost_estimated).total_cmp(&rank(a.cost, a.cost_estimated)));
    Ok(out)
}

type RateTables = (
    HashMap<(String, String), Vec<f64>>,
    HashMap<(String, String, String), Vec<f64>>,
);

fn rate_samples(conn: &Connection, params: DayParams) -> Result<RateTables, String> {
    let mut by_model: HashMap<(String, String), Vec<f64>> = HashMap::new();
    let mut by_variant: HashMap<(String, String, String), Vec<f64>> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT provider, model_id, variant, tps FROM rate_samples \
             WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4)",
        )
        .map_err(|e| e.to_string())?;
    let samples = stmt
        .query_map(params, |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for sample in samples {
        let (provider, model, variant, tps) = sample.map_err(|e| e.to_string())?;
        by_model
            .entry((provider.clone(), model.clone()))
            .or_default()
            .push(tps);
        by_variant
            .entry((provider, model, variant))
            .or_default()
            .push(tps);
    }
    Ok((by_model, by_variant))
}

fn model_stats(conn: &Connection, params: DayParams) -> Result<Vec<GroupStat>, String> {
    let (mut by_model, mut by_variant) = rate_samples(conn, params)?;

    let mut variants: HashMap<(String, String), Vec<GroupStat>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT f.provider, f.model_id, f.variant, {sums}, COALESCE(SUM(f.msgs),0), \
                 COUNT(DISTINCT f.session_id), MIN(f.min_ts), MAX(f.max_ts) \
                 {FACT_FROM} {FACT_WHERE} GROUP BY f.provider, f.model_id, f.variant",
                sums = fact_sums()
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params, |row| {
                let provider: String = row.get(0)?;
                let model_id: String = row.get(1)?;
                let variant: String = row.get(2)?;
                let (cost, tokens) = read_money(row, 3)?;
                Ok((
                    provider.clone(),
                    model_id.clone(),
                    variant.clone(),
                    GroupStat {
                        key: model_id,
                        provider: Some(provider),
                        variant: Some(variant).filter(|v| !v.is_empty()),
                        cost: cost.reported,
                        cost_estimated: cost.estimated,
                        tokens,
                        messages: row.get(10)?,
                        sessions: row.get(11)?,
                        first_used: row.get(12)?,
                        last_used: row.get(13)?,
                        ..Default::default()
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (provider, model_id, variant, mut stat) = row.map_err(|e| e.to_string())?;
            if let Some(values) = by_variant.get_mut(&(provider.clone(), model_id.clone(), variant))
            {
                stat.p50_output_tps = median(values);
            }
            variants.entry((provider, model_id)).or_default().push(stat);
        }
    }

    let mut stmt = conn
        .prepare(&format!(
            "SELECT f.provider, f.model_id, {sums}, COALESCE(SUM(f.msgs),0), \
             COUNT(DISTINCT f.session_id), MIN(f.min_ts), MAX(f.max_ts) \
             {FACT_FROM} {FACT_WHERE} GROUP BY f.provider, f.model_id",
            sums = fact_sums()
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let provider: String = row.get(0)?;
            let model_id: String = row.get(1)?;
            let (cost, tokens) = read_money(row, 2)?;
            Ok((
                provider.clone(),
                model_id.clone(),
                GroupStat {
                    key: model_id,
                    provider: Some(provider),
                    cost: cost.reported,
                    cost_estimated: cost.estimated,
                    tokens,
                    messages: row.get(9)?,
                    sessions: row.get(10)?,
                    first_used: row.get(11)?,
                    last_used: row.get(12)?,
                    ..Default::default()
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out: Vec<GroupStat> = Vec::new();
    for row in rows {
        let (provider, model_id, mut stat) = row.map_err(|e| e.to_string())?;
        if let Some(values) = by_model.get_mut(&(provider.clone(), model_id.clone())) {
            stat.p50_output_tps = median(values);
        }
        let mut children = variants.remove(&(provider, model_id)).unwrap_or_default();
        children
            .sort_by(|a, b| rank(b.cost, b.cost_estimated).total_cmp(&rank(a.cost, a.cost_estimated)));
        // A lone variant carries no information the model row does not already
        // show, so it collapses into a badge instead of a disclosable child.
        match children.len() {
            0 => {}
            1 => stat.variant = children[0].variant.clone(),
            _ => stat.variants = children,
        }
        out.push(stat);
    }
    out.sort_by(|a, b| rank(b.cost, b.cost_estimated).total_cmp(&rank(a.cost, a.cost_estimated)));
    Ok(out)
}

pub fn group_stats(
    conn: &Connection,
    params: DayParams,
    by_agent: bool,
    normalize_agents: bool,
) -> Result<Vec<GroupStat>, String> {
    if by_agent {
        agent_stats(conn, params, normalize_agents)
    } else {
        model_stats(conn, params)
    }
}

pub fn group_daily(
    conn: &Connection,
    params: DayParams,
    by_agent: bool,
) -> Result<Vec<ModelDailyPoint>, String> {
    let key = if by_agent {
        "f.agent"
    } else {
        "f.provider || '/' || f.model_id"
    };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT f.day, {key}, COALESCE(SUM(f.cost),0), {COST_EST}, \
             COALESCE(SUM(f.tok_input + f.tok_output + f.tok_reasoning + f.tok_cache_read + f.tok_cache_write),0) \
             {FACT_FROM} {FACT_WHERE} GROUP BY f.day, {key} ORDER BY f.day"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            Ok(ModelDailyPoint {
                date: row.get(0)?,
                key: row.get(1)?,
                cost: row.get(2)?,
                cost_estimated: row.get(3)?,
                total_tokens: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn project_stats(conn: &Connection, params: DayParams) -> Result<Vec<ProjectStat>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT f.project_id, COALESCE(d.name,''), COALESCE(d.worktree,''), {sums}, \
             COALESCE(SUM(f.msgs),0), COUNT(DISTINCT f.session_id) \
             {FACT_FROM} LEFT JOIN project_dim d \
             ON d.source_id = f.source_id AND d.project_id = f.project_id \
             {FACT_WHERE} GROUP BY f.project_id",
            sums = fact_sums()
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let (cost, tokens) = read_money(row, 3)?;
            Ok(ProjectStat {
                project_id: row.get(0)?,
                name: row.get(1)?,
                worktree: row.get(2)?,
                cost: cost.reported,
                cost_estimated: cost.estimated,
                tokens,
                messages: row.get(10)?,
                sessions: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<ProjectStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    out.sort_by(|a, b| rank(b.cost, b.cost_estimated).total_cmp(&rank(a.cost, a.cost_estimated)));
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

pub fn skill_stats(conn: &Connection, params: DayParams) -> Result<Vec<SkillStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill, SUM(via_task), SUM(direct), COUNT(DISTINCT session_id), \
             COUNT(DISTINCT project_id), MIN(min_ts), MAX(max_ts) \
             FROM fact_skills WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY skill",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let via_task: i64 = row.get(1)?;
            let direct: i64 = row.get(2)?;
            Ok(SkillStat {
                skill: row.get(0)?,
                loads: via_task + direct,
                via_task,
                direct,
                sessions: row.get(3)?,
                projects: row.get(4)?,
                first_used: row.get(5)?,
                last_used: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<SkillStat> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    out.sort_by(|a, b| b.loads.cmp(&a.loads).then_with(|| a.skill.cmp(&b.skill)));
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

const HOUR_MS: i64 = 3_600_000;
const WEEK_MS: i64 = 7 * 24 * HOUR_MS;
/// Where the gauge turns from "fine" to "you are about to run out". Matches the
/// threshold ccusage warns at.
const WARN_FRACTION: f64 = 0.8;

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub start: i64,
    pub end: i64,
    pub active: bool,
    pub cost: f64,
    pub cost_estimated: f64,
    pub tokens: i64,
    pub messages: i64,
}

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReport {
    pub window_hours: i64,
    pub windows: Vec<QuotaWindow>,
    pub active: Option<QuotaWindow>,
    pub burn_tokens_per_min: f64,
    pub burn_cost_per_min: f64,
    pub projected_tokens: i64,
    pub projected_cost: f64,
    /// Largest completed window on record. opencode does not expose the real
    /// plan limit, so the busiest window the user has actually sustained is the
    /// only honest reference point for the gauge.
    pub reference_tokens: i64,
    pub warn_fraction: f64,
    pub week_tokens: i64,
    pub week_cost: f64,
    pub week_cost_estimated: f64,
}

/// Windows are anchored to the exact first message after a gap, not to the top
/// of the hour. Anthropic resets five hours from when you actually sent that
/// message, so flooring to the hour reports a reset up to 59 minutes early —
/// measured against Claude's own UI, a 20:31 first message resets at 01:31, not
/// 01:00. (ccusage floors to the hour; it is an approximation, not the rule.)
fn fold_windows(samples: &[(i64, f64, f64, i64)], window_ms: i64) -> Vec<QuotaWindow> {
    let mut windows: Vec<QuotaWindow> = Vec::new();
    for &(ts, cost, estimated, tokens) in samples {
        let needs_new = match windows.last() {
            Some(current) => ts >= current.end,
            None => true,
        };
        if needs_new {
            windows.push(QuotaWindow {
                start: ts,
                end: ts + window_ms,
                ..Default::default()
            });
        }
        let current = windows.last_mut().expect("window pushed above");
        current.cost += cost;
        current.cost_estimated += estimated;
        current.tokens += tokens;
        current.messages += 1;
    }
    windows
}

pub fn quota(
    conn: &Connection,
    source_id: i64,
    now: i64,
    window_hours: i64,
) -> Result<QuotaReport, String> {
    let window_ms = window_hours.clamp(1, 24 * 7) * HOUR_MS;
    let mut stmt = conn
        .prepare(
            "SELECT s.ts, s.cost, \
             (s.tok_input * COALESCE(p.input,0) + s.tok_output * COALESCE(p.output,0) \
              + s.tok_cache_read * COALESCE(p.cache_read,0) \
              + s.tok_cache_write * COALESCE(p.cache_write,0)) / 1000000.0, \
             s.tok_input + s.tok_output + s.tok_cache_read + s.tok_cache_write \
             FROM usage_sample s LEFT JOIN model_price p \
             ON p.provider = s.provider AND p.model_id = s.model_id \
             WHERE s.source_id = ?1 ORDER BY s.ts",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?;
    let samples: Vec<(i64, f64, f64, i64)> =
        rows.collect::<Result<_, _>>().map_err(|e: rusqlite::Error| e.to_string())?;

    let mut windows = fold_windows(&samples, window_ms);
    for window in &mut windows {
        window.active = now >= window.start && now < window.end;
    }

    let active = windows.iter().find(|w| w.active).cloned();
    let reference_tokens = windows
        .iter()
        .filter(|w| !w.active)
        .map(|w| w.tokens)
        .max()
        .unwrap_or(0);

    let mut report = QuotaReport {
        window_hours: window_ms / HOUR_MS,
        reference_tokens,
        warn_fraction: WARN_FRACTION,
        ..Default::default()
    };

    for &(ts, cost, estimated, tokens) in &samples {
        if ts >= now - WEEK_MS {
            report.week_tokens += tokens;
            report.week_cost += cost;
            report.week_cost_estimated += estimated;
        }
    }

    if let Some(window) = &active {
        // Elapsed is clamped to at least a minute so a window that just opened
        // cannot divide by ~zero and report an astronomical burn rate.
        let elapsed_min = (((now - window.start) as f64) / 60_000.0).max(1.0);
        let remaining_min = (((window.end - now) as f64) / 60_000.0).max(0.0);
        report.burn_tokens_per_min = window.tokens as f64 / elapsed_min;
        report.burn_cost_per_min = rank(window.cost, window.cost_estimated) / elapsed_min;
        report.projected_tokens =
            window.tokens + (report.burn_tokens_per_min * remaining_min) as i64;
        report.projected_cost = rank(window.cost, window.cost_estimated)
            + report.burn_cost_per_min * remaining_min;
    }

    windows.reverse();
    windows.truncate(48);
    report.windows = windows;
    report.active = active;
    Ok(report)
}

/// Chroma's context-rot work shows accuracy degrading well before a model's
/// advertised limit, so "near the limit" is flagged from 70% rather than at the
/// hard boundary where requests actually start failing.
const NEAR_LIMIT_FRACTION: f64 = 0.7;

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextHealth {
    pub window_days: i64,
    pub messages: i64,
    pub p50: f64,
    pub p95: f64,
    pub max: f64,
    pub near_limit: i64,
    pub near_limit_fraction: f64,
}

/// How full the prompt was relative to each model's context window. Measured
/// per message from the retained samples, so it covers the same recent window
/// the quota view does rather than all of history.
pub fn context_health(
    conn: &Connection,
    source_id: i64,
    window_days: i64,
) -> Result<ContextHealth, String> {
    let mut stmt = conn
        .prepare(
            "SELECT (s.tok_input + s.tok_cache_read + s.tok_cache_write) * 1.0 / p.context \
             FROM usage_sample s JOIN model_price p \
             ON p.provider = s.provider AND p.model_id = s.model_id \
             WHERE s.source_id = ?1 AND p.context > 0",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source_id], |r| r.get::<_, f64>(0))
        .map_err(|e| e.to_string())?;
    let mut used: Vec<f64> = rows
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;
    if used.is_empty() {
        return Ok(ContextHealth {
            window_days,
            near_limit_fraction: NEAR_LIMIT_FRACTION,
            ..Default::default()
        });
    }
    used.sort_by(|a, b| a.total_cmp(b));
    Ok(ContextHealth {
        window_days,
        messages: used.len() as i64,
        p50: percentile(&used, 0.5).unwrap_or(0.0),
        p95: percentile(&used, 0.95).unwrap_or(0.0),
        max: used.last().copied().unwrap_or(0.0),
        near_limit: used.iter().filter(|u| **u >= NEAR_LIMIT_FRACTION).count() as i64,
        near_limit_fraction: NEAR_LIMIT_FRACTION,
    })
}

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionCostStats {
    pub sessions: i64,
    pub p50: f64,
    pub p95: f64,
    pub max: f64,
}

/// Cost distribution across sessions. p95 is the point of this: an average
/// session cost hides the runaway ones, and a single session that looped for an
/// hour is exactly what a spend dashboard should surface.
pub fn session_costs(conn: &Connection, params: DayParams) -> Result<SessionCostStats, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT COALESCE(SUM(f.cost),0), {COST_EST} \
             {FACT_FROM} {FACT_WHERE} GROUP BY f.session_id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut costs: Vec<f64> = Vec::new();
    for row in rows {
        let (reported, estimated) = row.map_err(|e| e.to_string())?;
        costs.push(rank(reported, estimated));
    }
    if costs.is_empty() {
        return Ok(SessionCostStats::default());
    }
    costs.sort_by(|a, b| a.total_cmp(b));
    Ok(SessionCostStats {
        sessions: costs.len() as i64,
        p50: percentile(&costs, 0.5).unwrap_or(0.0),
        p95: percentile(&costs, 0.95).unwrap_or(0.0),
        max: costs.last().copied().unwrap_or(0.0),
    })
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetail {
    pub scope: String,
    pub name: String,
    pub message: String,
    pub count: i64,
}

pub fn error_details(conn: &Connection, params: DayParams) -> Result<Vec<ErrorDetail>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT scope, name, message, SUM(count) FROM fact_errors \
             WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY scope, name, message ORDER BY 4 DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |r| {
            Ok(ErrorDetail {
                scope: r.get(0)?,
                name: r.get(1)?,
                message: r.get(2)?,
                count: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub reads: i64,
    pub edits: i64,
    pub writes: i64,
    pub touches: i64,
}

pub fn file_stats(conn: &Connection, params: DayParams) -> Result<Vec<FileStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, SUM(reads), SUM(edits), SUM(writes), SUM(reads + edits + writes) t \
             FROM fact_files \
             WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY path ORDER BY t DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |r| {
            Ok(FileStat {
                path: r.get(0)?,
                reads: r.get(1)?,
                edits: r.get(2)?,
                writes: r.get(3)?,
                touches: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedundancyStat {
    pub tool: String,
    pub calls: i64,
    pub repeated_calls: i64,
    pub sessions: i64,
}

/// A call repeated three or more times with byte-identical arguments inside one
/// session is the standard signal for an agent stuck in a loop; below that it is
/// ordinary re-reading. Only the calls beyond the first are counted as waste.
pub fn redundancy(conn: &Connection, params: DayParams) -> Result<Vec<RedundancyStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT tool, SUM(calls), SUM(CASE WHEN calls >= 3 THEN calls - 1 ELSE 0 END), \
             COUNT(DISTINCT CASE WHEN calls >= 3 THEN session_id END) \
             FROM fact_tool_calls \
             WHERE source_id = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR project_id = ?4) \
             GROUP BY tool HAVING SUM(CASE WHEN calls >= 3 THEN calls - 1 ELSE 0 END) > 0 \
             ORDER BY 3 DESC LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |r| {
            Ok(RedundancyStat {
                tool: r.get(0)?,
                calls: r.get(1)?,
                repeated_calls: r.get(2)?,
                sessions: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// These contribute zero to every estimate, so they are named in Settings rather
/// than left to make a silently-low total look authoritative.
pub fn unpriced_models(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.provider || '/' || f.model_id \
             FROM fact_messages f LEFT JOIN model_price p \
             ON p.provider = f.provider AND p.model_id = f.model_id \
             WHERE p.provider IS NULL ORDER BY 1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_with(tokens: [i64; 4], reported: f64, price: [f64; 4]) -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory cache");
        crate::cache::migrations::run(&conn).expect("migrations apply");
        conn.execute(
            "INSERT INTO source (id, path) VALUES (1, 'test')",
            [],
        )
        .expect("source row");
        conn.execute(
            "INSERT INTO fact_messages (source_id, day, session_id, provider, model_id, variant, agent, \
             project_id, cost, tok_input, tok_output, tok_reasoning, tok_cache_read, tok_cache_write, \
             msgs, min_ts, max_ts) \
             VALUES (1,'2026-08-01','s','anthropic','m','','a','p',?1,?2,?3,0,?4,?5,1,0,0)",
            rusqlite::params![reported, tokens[0], tokens[1], tokens[2], tokens[3]],
        )
        .expect("fact row");
        conn.execute(
            "INSERT INTO model_price (provider, model_id, input, output, cache_read, cache_write, context) \
             VALUES ('anthropic','m',?1,?2,?3,?4,1000)",
            rusqlite::params![price[0], price[1], price[2], price[3]],
        )
        .expect("price row");
        conn
    }

    fn overview_of(conn: &Connection) -> Overview {
        overview(conn, (1, "0000-01-01", "9999-12-31", None)).expect("overview")
    }

    /// The estimate is only trustworthy if it reproduces opencode's own figure on
    /// traffic opencode actually priced. These are the real aggregate token counts
    /// and reported cost for anthropic/claude-opus-4-7 across 15,395 metered
    /// messages, checked against the live models.dev rates for that model.
    #[test]
    fn estimate_reproduces_opencode_reported_cost_on_metered_traffic() {
        let conn = cache_with(
            [42_154, 16_890_003, 3_755_433_886, 208_657_252],
            3_604.285_613,
            [5.0, 25.0, 0.5, 6.25],
        );
        let acc = overview_of(&conn);
        let drift = (acc.cost_estimated - acc.cost).abs() / acc.cost;
        assert!(
            drift < 0.0001,
            "estimated {} should match reported {} (drift {drift})",
            acc.cost_estimated,
            acc.cost
        );
    }

    /// The case the whole feature exists for: subscription traffic is stored with
    /// cost = 0, and must still produce a non-zero estimate.
    #[test]
    fn unmetered_traffic_reports_zero_but_still_estimates() {
        let conn = cache_with([1_000_000, 1_000_000, 0, 0], 0.0, [5.0, 25.0, 0.5, 6.25]);
        let acc = overview_of(&conn);
        assert_eq!(acc.cost, 0.0);
        assert!((acc.cost_estimated - 30.0).abs() < 1e-9, "got {}", acc.cost_estimated);
    }

    fn cache_with_agents(rows: &[(&str, &str, f64)]) -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory cache");
        crate::cache::migrations::run(&conn).expect("migrations apply");
        conn.execute("INSERT INTO source (id, path) VALUES (1, 'test')", [])
            .expect("source row");
        for (i, (agent, session, cost)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO fact_messages (source_id, day, session_id, provider, model_id, variant, \
                 agent, project_id, cost, tok_input, tok_output, tok_reasoning, tok_cache_read, \
                 tok_cache_write, msgs, min_ts, max_ts) \
                 VALUES (1,'2026-08-01',?1,'anthropic','m','',?2,'p',?3,0,0,0,0,0,1,?4,?4)",
                rusqlite::params![session, agent, cost, i as i64],
            )
            .expect("fact row");
            conn.execute(
                "INSERT INTO agent_dim (source_id, agent_raw, agent_key, display) VALUES (1,?1,?2,?3) \
                 ON CONFLICT(source_id, agent_raw) DO NOTHING",
                rusqlite::params![
                    agent,
                    crate::agents::normalize_key(agent),
                    crate::agents::clean_display(agent)
                ],
            )
            .expect("dim row");
        }
        conn
    }

    fn agents_of(conn: &Connection, normalize: bool) -> Vec<GroupStat> {
        group_stats(conn, (1, "0000-01-01", "9999-12-31", None), true, normalize).expect("agents")
    }

    /// The regression this guards: `sessions` is a COUNT(DISTINCT session_id).
    /// One session that used two spellings of the same agent must count once
    /// after merging — summing the per-spelling counts would report two.
    #[test]
    fn merging_agents_does_not_double_count_a_shared_session() {
        let conn = cache_with_agents(&[
            ("\u{200B}Sisyphus - Ultraworker", "ses_a", 1.0),
            ("Sisyphus - ultraworker", "ses_a", 2.0),
        ]);

        let raw = agents_of(&conn, false);
        assert_eq!(raw.len(), 2, "unnormalised keeps both spellings apart");

        let merged = agents_of(&conn, true);
        assert_eq!(merged.len(), 1, "spellings collapse into one agent");
        assert_eq!(merged[0].sessions, 1, "the shared session counts once");
        assert_eq!(merged[0].cost, 3.0, "costs add");
        assert_eq!(merged[0].messages, 2);
    }

    #[test]
    fn merging_agents_still_counts_distinct_sessions() {
        let conn = cache_with_agents(&[
            ("Sisyphus", "ses_a", 1.0),
            ("sisyphus", "ses_b", 1.0),
        ]);
        let merged = agents_of(&conn, true);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].sessions, 2, "different sessions still count twice");
    }

    /// Sisyphus-Junior is a different agent, not a spelling of Sisyphus.
    #[test]
    fn merging_agents_keeps_distinct_agents_separate() {
        let conn = cache_with_agents(&[
            ("Sisyphus", "ses_a", 1.0),
            ("Sisyphus-Junior", "ses_b", 5.0),
        ]);
        assert_eq!(agents_of(&conn, true).len(), 2);
    }

    /// The label follows the most recently used spelling, so a renamed agent
    /// shows its current name.
    #[test]
    fn merged_agent_is_labelled_with_its_newest_spelling() {
        let conn = cache_with_agents(&[("sisyphus", "ses_a", 1.0), ("Sisyphus", "ses_b", 1.0)]);
        assert_eq!(agents_of(&conn, true)[0].key, "Sisyphus");
    }

    const H: i64 = HOUR_MS;

    fn sample(ts: i64, tokens: i64) -> (i64, f64, f64, i64) {
        (ts, 1.0, 2.0, tokens)
    }

    const W: i64 = 5 * HOUR_MS;

    /// Regression: the window used to be floored to the top of the hour, which
    /// reported a reset up to 59 minutes early. Anthropic resets five hours from
    /// the exact first message — a 20:31 start resets at 01:31.
    #[test]
    fn window_starts_at_the_exact_first_message_not_the_hour() {
        let first = 20 * HOUR_MS + 31 * 60_000;
        let windows = fold_windows(&[sample(first, 10)], W);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].start, first, "no flooring to the hour");
        assert_eq!(windows[0].end, first + W, "resets exactly five hours later");
    }

    #[test]
    fn messages_inside_the_window_share_it() {
        let windows = fold_windows(
            &[
                sample(H, 10),
                sample(H + 2 * H, 20),
                sample(H + W - 60_000, 30),
            ],
            W,
        );
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].tokens, 60);
        assert_eq!(windows[0].messages, 3);
    }

    /// The boundary is exclusive: a message landing exactly on the end of a
    /// window belongs to the next one, otherwise windows would overlap.
    #[test]
    fn a_message_at_the_boundary_opens_the_next_window() {
        let windows = fold_windows(&[sample(H, 10), sample(H + W, 20)], W);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].tokens, 10);
        assert_eq!(windows[1].start, H + W);
    }

    /// Windows follow activity rather than the clock, so an idle stretch does
    /// not emit empty windows — the next message simply opens a fresh one.
    #[test]
    fn a_long_gap_opens_a_fresh_window_without_filling_the_silence() {
        let windows = fold_windows(&[sample(H, 10), sample(H + 100 * H, 20)], W);
        assert_eq!(windows.len(), 2, "no empty windows across the gap");
        assert_eq!(windows[1].start, H + 100 * H);
    }

    /// The five-hour window is an Anthropic convention, so the length has to be
    /// settable for anyone on a different plan or provider.
    #[test]
    fn window_length_is_configurable() {
        let windows = fold_windows(&[sample(0, 1), sample(3 * H, 1)], 2 * HOUR_MS);
        assert_eq!(windows.len(), 2, "a two-hour window splits what five would join");
    }

    #[test]
    fn quota_reports_burn_rate_and_projection_for_the_active_window() {
        let conn = Connection::open_in_memory().expect("cache");
        crate::cache::migrations::run(&conn).expect("migrate");
        conn.execute("INSERT INTO source (id, path) VALUES (1,'t')", [])
            .expect("source");
        conn.execute(
            "INSERT INTO model_price (provider, model_id, input, output, cache_read, cache_write, context) \
             VALUES ('anthropic','m',0,0,0,0,0)",
            [],
        )
        .expect("price");

        // Window opens at t=0; "now" is two hours in with 120 tokens spent.
        let now = 2 * H;
        for (i, ts) in [0_i64, H].iter().enumerate() {
            conn.execute(
                "INSERT INTO usage_sample (source_id, msg_id, ts, provider, model_id, cost, \
                 tok_input, tok_output, tok_cache_read, tok_cache_write) \
                 VALUES (1,?1,?2,'anthropic','m',1.0,60,0,0,0)",
                rusqlite::params![format!("m{i}"), ts],
            )
            .expect("sample");
        }

        let report = quota(&conn, 1, now, 5).expect("quota");
        let active = report.active.expect("a window contains now");
        assert_eq!(active.tokens, 120);
        assert!(active.active);
        // 120 tokens over 120 minutes elapsed.
        assert!((report.burn_tokens_per_min - 1.0).abs() < 1e-6);
        // Three hours left at one token per minute.
        assert_eq!(report.projected_tokens, 120 + 180);
        assert_eq!(report.week_tokens, 120);
    }

    #[test]
    fn quota_is_empty_without_samples() {
        let conn = Connection::open_in_memory().expect("cache");
        crate::cache::migrations::run(&conn).expect("migrate");
        let report = quota(&conn, 1, 0, 5).expect("quota");
        assert!(report.active.is_none());
        assert_eq!(report.windows.len(), 0);
        assert_eq!(report.burn_tokens_per_min, 0.0);
    }

    /// An unpriced model must keep contributing its tokens to every other metric
    /// instead of being dropped by the price join.
    #[test]
    fn unpriced_model_keeps_its_tokens_and_is_reported() {
        let conn = cache_with([1_000_000, 0, 0, 0], 0.0, [5.0, 25.0, 0.5, 6.25]);
        conn.execute("DELETE FROM model_price", []).expect("drop prices");
        let acc = overview_of(&conn);
        assert_eq!(acc.tokens.input, 1_000_000, "tokens survive the join");
        assert_eq!(acc.cost_estimated, 0.0);
        assert_eq!(unpriced_models(&conn).expect("query"), vec!["anthropic/m"]);
    }
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
