use crate::cache::CacheManager;
use crate::db;
use chrono::{Local, TimeZone, Timelike};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::Ordering;

const BATCH_SIZE: usize = 20_000;
const PENDING_MAX_AGE_MS: i64 = 24 * 3_600_000;

/// How much per-message detail the quota view keeps. Long enough to cover a
/// weekly limit with room to spare; everything older is served by the day-grain
/// facts, so retaining more would grow the cache for no visible benefit.
pub const SAMPLE_RETENTION_DAYS: i64 = 14;
const SAMPLE_RETENTION_MS: i64 = SAMPLE_RETENTION_DAYS * 24 * 3_600_000;

const MSG_PROJECTION: &str = "SELECT id, session_id, time_created, \
  COALESCE(json_extract(data,'$.role'),''), \
  COALESCE(json_extract(data,'$.providerID'),json_extract(data,'$.model.providerID'),'unknown'), \
  COALESCE(json_extract(data,'$.modelID'),json_extract(data,'$.model.modelID'),'unknown'), \
  COALESCE(json_extract(data,'$.variant'),json_extract(data,'$.model.variant'),''), \
  COALESCE(json_extract(data,'$.agent'),'unknown'), \
  COALESCE(json_extract(data,'$.cost'),0), \
  COALESCE(json_extract(data,'$.tokens.input'),0), \
  COALESCE(json_extract(data,'$.tokens.output'),0), \
  COALESCE(json_extract(data,'$.tokens.reasoning'),0), \
  COALESCE(json_extract(data,'$.tokens.cache.read'),0), \
  COALESCE(json_extract(data,'$.tokens.cache.write'),0), \
  json_extract(data,'$.time.completed'), \
  json_extract(data,'$.error.name'), \
  json_extract(data,'$.error.data.message'), \
  COALESCE(json_extract(data,'$.finish'),''), \
  rowid \
  FROM message";

const PART_PROJECTION: &str = "SELECT id, time_created, \
  COALESCE(json_extract(data,'$.type'),''), \
  COALESCE(json_extract(data,'$.tool'),'unknown'), \
  COALESCE(json_extract(data,'$.state.status'),''), \
  json_extract(data,'$.state.time.start'), \
  json_extract(data,'$.state.time.end'), \
  COALESCE(json_extract(data,'$.auto'),0), \
  COALESCE(json_extract(data,'$.overflow'),0), \
  session_id, \
  rowid, \
  json_extract(data,'$.state.input.load_skills'), \
  json_extract(data,'$.state.input.name'), \
  json_extract(data,'$.state.error'), \
  COALESCE(json_extract(data,'$.state.input.filePath'),json_extract(data,'$.state.input.path')), \
  json_extract(data,'$.state.input'), \
  json_extract(data,'$.files') \
  FROM part";

struct MsgRow {
    id: String,
    session_id: String,
    time_created: i64,
    role: String,
    provider: String,
    model_id: String,
    variant: String,
    agent: String,
    cost: f64,
    tokens: [i64; 5],
    completed: Option<i64>,
    error_name: Option<String>,
    error_message: Option<String>,
    finish: String,
    rowid: i64,
}

struct PartRow {
    id: String,
    time_created: i64,
    part_type: String,
    tool: String,
    status: String,
    start: Option<i64>,
    end: Option<i64>,
    auto: i64,
    overflow: i64,
    session_id: String,
    rowid: i64,
    load_skills: Option<String>,
    skill_name: Option<String>,
    error: Option<String>,
    file_path: Option<String>,
    input: Option<String>,
    patch_files: Option<String>,
}

#[derive(Default)]
struct MsgAgg {
    project_id: String,
    cost: f64,
    tokens: [i64; 5],
    msgs: i64,
    min_ts: i64,
    max_ts: i64,
}

#[derive(PartialEq, Eq, Hash)]
struct MsgKey {
    day: String,
    session_id: String,
    provider: String,
    model_id: String,
    variant: String,
    agent: String,
}

struct RateSample {
    day: String,
    provider: String,
    model_id: String,
    variant: String,
    project_id: String,
    tps: f64,
}

#[derive(Default)]
struct ToolAgg {
    calls: i64,
    completed: i64,
    errors: i64,
    total_duration: f64,
}

#[derive(Default)]
struct SkillAgg {
    via_task: i64,
    direct: i64,
    min_ts: i64,
    max_ts: i64,
}

#[derive(PartialEq, Eq, Hash)]
struct SkillKey {
    day: String,
    skill: String,
    session_id: String,
    project_id: String,
}

struct UsageSample {
    msg_id: String,
    ts: i64,
    provider: String,
    model_id: String,
    cost: f64,
    tokens: [i64; 4],
}

#[derive(Default)]
struct FileAgg {
    reads: i64,
    edits: i64,
    writes: i64,
}

/// Failure text is truncated before it becomes part of a primary key: some
/// errors embed a whole response body, and the point is to group recurring
/// failures, not to archive every byte of one.
const ERROR_TEXT_LIMIT: usize = 200;

fn clip(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    match trimmed.char_indices().nth(limit) {
        Some((at, _)) => trimmed[..at].to_string(),
        None => trimmed.to_string(),
    }
}

fn input_hash(tool: &str, input: &str) -> i64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    tool.hash(&mut hasher);
    input.hash(&mut hasher);
    hasher.finish() as i64
}

#[derive(Default)]
struct Batch {
    samples: Vec<UsageSample>,
    errors: HashMap<(String, String, String, String, String), i64>,
    files: HashMap<(String, String, String), FileAgg>,
    tool_calls: HashMap<(String, String, i64), (String, String, i64)>,
    messages: HashMap<MsgKey, MsgAgg>,
    prompts: HashMap<(String, String), i64>,
    hourly: HashMap<(String, u8, String), i64>,
    tools: HashMap<(String, String, String), ToolAgg>,
    skills: HashMap<SkillKey, SkillAgg>,
    events: HashMap<(String, String, String), i64>,
    durations: Vec<(String, String, String, f64)>,
    rates: Vec<RateSample>,
    pending_add: Vec<(String, String, i64)>,
    pending_del: Vec<(String, String)>,
}

fn project_of(projects: &HashMap<String, String>, session_id: &str) -> String {
    projects
        .get(session_id)
        .cloned()
        .unwrap_or_else(|| "unknown".to_string())
}

fn local_day_hour(ms: i64) -> (String, u8) {
    let dt = Local
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Local::now);
    (dt.format("%Y-%m-%d").to_string(), dt.hour() as u8)
}

fn map_msg_row(row: &rusqlite::Row) -> rusqlite::Result<MsgRow> {
    Ok(MsgRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        time_created: row.get(2)?,
        role: row.get(3)?,
        provider: row.get(4)?,
        model_id: row.get(5)?,
        variant: row.get(6)?,
        agent: row.get(7)?,
        cost: row.get(8)?,
        tokens: [
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
            row.get(13)?,
        ],
        completed: row.get(14)?,
        error_name: row.get(15)?,
        error_message: row.get(16)?,
        finish: row.get(17)?,
        rowid: row.get(18)?,
    })
}

fn map_part_row(row: &rusqlite::Row) -> rusqlite::Result<PartRow> {
    Ok(PartRow {
        id: row.get(0)?,
        time_created: row.get(1)?,
        part_type: row.get(2)?,
        tool: row.get(3)?,
        status: row.get(4)?,
        start: row.get(5)?,
        end: row.get(6)?,
        auto: row.get(7)?,
        overflow: row.get(8)?,
        session_id: row.get(9)?,
        rowid: row.get(10)?,
        load_skills: row.get(11)?,
        skill_name: row.get(12)?,
        error: row.get(13)?,
        file_path: row.get(14)?,
        input: row.get(15)?,
        patch_files: row.get(16)?,
    })
}

fn ingest_message(
    row: &MsgRow,
    force: bool,
    now: i64,
    projects: &HashMap<String, String>,
    batch: &mut Batch,
) -> bool {
    let (day, hour) = local_day_hour(row.time_created);
    let project = project_of(projects, &row.session_id);
    if row.role == "user" {
        *batch.prompts.entry((day, project)).or_default() += 1;
        return true;
    }
    if row.role != "assistant" {
        return true;
    }
    let terminal = row.completed.is_some() || row.error_name.is_some();
    let aged = now - row.time_created > PENDING_MAX_AGE_MS;
    if !terminal && !aged && !force {
        return false;
    }
    if now - row.time_created <= SAMPLE_RETENTION_MS {
        batch.samples.push(UsageSample {
            msg_id: row.id.clone(),
            ts: row.time_created,
            provider: row.provider.clone(),
            model_id: row.model_id.clone(),
            cost: row.cost,
            tokens: [row.tokens[0], row.tokens[1], row.tokens[3], row.tokens[4]],
        });
    }
    let key = MsgKey {
        day: day.clone(),
        session_id: row.session_id.clone(),
        provider: row.provider.clone(),
        model_id: row.model_id.clone(),
        variant: row.variant.clone(),
        agent: row.agent.clone(),
    };
    let agg = batch.messages.entry(key).or_default();
    if agg.msgs == 0 {
        agg.project_id = project.clone();
        agg.min_ts = row.time_created;
        agg.max_ts = row.time_created;
    }
    agg.cost += row.cost;
    for i in 0..5 {
        agg.tokens[i] += row.tokens[i];
    }
    agg.msgs += 1;
    agg.min_ts = agg.min_ts.min(row.time_created);
    agg.max_ts = agg.max_ts.max(row.time_created);
    *batch
        .hourly
        .entry((day.clone(), hour, project.clone()))
        .or_default() += 1;
    if let Some(name) = &row.error_name {
        *batch
            .events
            .entry((day.clone(), format!("error:{name}"), project.clone()))
            .or_default() += 1;
        *batch
            .errors
            .entry((
                day.clone(),
                "message".to_string(),
                name.clone(),
                clip(row.error_message.as_deref().unwrap_or_default(), ERROR_TEXT_LIMIT),
                project.clone(),
            ))
            .or_default() += 1;
    }
    if let Some(completed) = row.completed {
        let duration = completed - row.time_created;
        if row.tokens[1] >= 100 && row.finish != "tool-calls" && duration > 0 {
            batch.rates.push(RateSample {
                day,
                provider: row.provider.clone(),
                model_id: row.model_id.clone(),
                variant: row.variant.clone(),
                project_id: project,
                tps: row.tokens[1] as f64 / (duration as f64 / 1000.0),
            });
        }
    }
    true
}

fn record_skill_use(
    batch: &mut Batch,
    row: &PartRow,
    day: &str,
    project: &str,
    skill: &str,
    via_task: bool,
) {
    let skill = skill.trim();
    if skill.is_empty() {
        return;
    }
    let agg = batch
        .skills
        .entry(SkillKey {
            day: day.to_string(),
            skill: skill.to_string(),
            session_id: row.session_id.clone(),
            project_id: project.to_string(),
        })
        .or_default();
    if via_task {
        agg.via_task += 1;
    } else {
        agg.direct += 1;
    }
    if agg.min_ts == 0 {
        agg.min_ts = row.time_created;
        agg.max_ts = row.time_created;
    }
    agg.min_ts = agg.min_ts.min(row.time_created);
    agg.max_ts = agg.max_ts.max(row.time_created);
}

fn ingest_skills(row: &PartRow, day: &str, project: &str, batch: &mut Batch) {
    match row.tool.as_str() {
        "task" => {
            let Some(raw) = row.load_skills.as_deref() else {
                return;
            };
            let Ok(serde_json::Value::Array(items)) = serde_json::from_str(raw) else {
                return;
            };
            for item in items {
                if let Some(name) = item.as_str() {
                    record_skill_use(batch, row, day, project, name, true);
                }
            }
        }
        "skill" => {
            if let Some(name) = row.skill_name.as_deref() {
                record_skill_use(batch, row, day, project, name, false);
            }
        }
        _ => {}
    }
}

fn ingest_part(
    row: &PartRow,
    force: bool,
    now: i64,
    projects: &HashMap<String, String>,
    batch: &mut Batch,
) -> bool {
    let (day, _) = local_day_hour(row.time_created);
    let project = project_of(projects, &row.session_id);
    match row.part_type.as_str() {
        "tool" => {
            let terminal = row.status == "completed" || row.status == "error";
            let aged = now - row.time_created > PENDING_MAX_AGE_MS;
            if !terminal && !aged && !force {
                return false;
            }
            ingest_skills(row, &day, &project, batch);
            if let Some(input) = &row.input {
                let entry = batch
                    .tool_calls
                    .entry((
                        row.session_id.clone(),
                        row.tool.clone(),
                        input_hash(&row.tool, input),
                    ))
                    .or_insert_with(|| (day.clone(), project.clone(), 0));
                entry.2 += 1;
            }
            if let Some(path) = &row.file_path {
                let agg = batch
                    .files
                    .entry((day.clone(), path.clone(), project.clone()))
                    .or_default();
                match row.tool.as_str() {
                    "read" => agg.reads += 1,
                    "edit" => agg.edits += 1,
                    "write" => agg.writes += 1,
                    _ => {}
                }
            }
            let agg = batch
                .tools
                .entry((day.clone(), row.tool.clone(), project.clone()))
                .or_default();
            agg.calls += 1;
            if row.status == "completed" {
                agg.completed += 1;
                if let (Some(start), Some(end)) = (row.start, row.end) {
                    if end >= start {
                        let duration = (end - start) as f64;
                        agg.total_duration += duration;
                        batch
                            .durations
                            .push((day, row.tool.clone(), project, duration));
                    }
                }
            } else if row.status == "error" {
                agg.errors += 1;
                *batch
                    .errors
                    .entry((
                        day.clone(),
                        "tool".to_string(),
                        row.tool.clone(),
                        clip(row.error.as_deref().unwrap_or_default(), ERROR_TEXT_LIMIT),
                        project.clone(),
                    ))
                    .or_default() += 1;
            }
            true
        }
        "compaction" => {
            let kind = if row.overflow != 0 {
                "compaction_overflow"
            } else if row.auto != 0 {
                "compaction_auto"
            } else {
                "compaction_manual"
            };
            *batch
                .events
                .entry((day, kind.to_string(), project))
                .or_default() += 1;
            true
        }
        "retry" => {
            *batch
                .events
                .entry((day, "retry".to_string(), project))
                .or_default() += 1;
            true
        }
        // A patch names every file it touched, which attributes edits that the
        // edit/write tools alone would miss.
        "patch" => {
            if let Some(raw) = row.patch_files.as_deref() {
                if let Ok(serde_json::Value::Array(files)) = serde_json::from_str(raw) {
                    for file in files {
                        if let Some(path) = file.as_str() {
                            batch
                                .files
                                .entry((day.clone(), path.to_string(), project.clone()))
                                .or_default()
                                .edits += 1;
                        }
                    }
                }
            }
            true
        }
        _ => true,
    }
}

fn flush(cache: &Connection, source_id: i64, batch: &mut Batch) -> Result<(), String> {
    let tx = cache.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_messages (source_id, day, session_id, provider, model_id, variant, agent, project_id, cost, tok_input, tok_output, tok_reasoning, tok_cache_read, tok_cache_write, msgs, min_ts, max_ts) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17) \
             ON CONFLICT(source_id, day, session_id, provider, model_id, variant, agent) DO UPDATE SET \
             cost = cost + excluded.cost, tok_input = tok_input + excluded.tok_input, \
             tok_output = tok_output + excluded.tok_output, tok_reasoning = tok_reasoning + excluded.tok_reasoning, \
             tok_cache_read = tok_cache_read + excluded.tok_cache_read, tok_cache_write = tok_cache_write + excluded.tok_cache_write, \
             msgs = msgs + excluded.msgs, min_ts = MIN(min_ts, excluded.min_ts), max_ts = MAX(max_ts, excluded.max_ts)",
        ).map_err(|e| e.to_string())?;
        for (key, agg) in batch.messages.drain() {
            stmt.execute(rusqlite::params![
                source_id, key.day, key.session_id, key.provider, key.model_id, key.variant,
                key.agent, agg.project_id, agg.cost,
                agg.tokens[0], agg.tokens[1], agg.tokens[2], agg.tokens[3], agg.tokens[4],
                agg.msgs, agg.min_ts, agg.max_ts,
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_prompts (source_id, day, project_id, count) VALUES (?1,?2,?3,?4) \
             ON CONFLICT(source_id, day, project_id) DO UPDATE SET count = count + excluded.count",
        ).map_err(|e| e.to_string())?;
        for ((day, project), count) in batch.prompts.drain() {
            stmt.execute(rusqlite::params![source_id, day, project, count])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_hourly (source_id, day, hour, project_id, count) VALUES (?1,?2,?3,?4,?5) \
             ON CONFLICT(source_id, day, hour, project_id) DO UPDATE SET count = count + excluded.count",
        ).map_err(|e| e.to_string())?;
        for ((day, hour, project), count) in batch.hourly.drain() {
            stmt.execute(rusqlite::params![source_id, day, hour, project, count])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_tools (source_id, day, tool, project_id, calls, completed, errors, total_duration_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) \
             ON CONFLICT(source_id, day, tool, project_id) DO UPDATE SET calls = calls + excluded.calls, \
             completed = completed + excluded.completed, errors = errors + excluded.errors, \
             total_duration_ms = total_duration_ms + excluded.total_duration_ms",
        ).map_err(|e| e.to_string())?;
        for ((day, tool, project), agg) in batch.tools.drain() {
            stmt.execute(rusqlite::params![
                source_id, day, tool, project, agg.calls, agg.completed, agg.errors, agg.total_duration,
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_skills (source_id, day, skill, session_id, project_id, via_task, direct, min_ts, max_ts) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) \
             ON CONFLICT(source_id, day, skill, session_id, project_id) DO UPDATE SET \
             via_task = via_task + excluded.via_task, direct = direct + excluded.direct, \
             min_ts = MIN(min_ts, excluded.min_ts), max_ts = MAX(max_ts, excluded.max_ts)",
        ).map_err(|e| e.to_string())?;
        for (key, agg) in batch.skills.drain() {
            stmt.execute(rusqlite::params![
                source_id,
                key.day,
                key.skill,
                key.session_id,
                key.project_id,
                agg.via_task,
                agg.direct,
                agg.min_ts,
                agg.max_ts,
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_events (source_id, day, kind, project_id, count) VALUES (?1,?2,?3,?4,?5) \
             ON CONFLICT(source_id, day, kind, project_id) DO UPDATE SET count = count + excluded.count",
        ).map_err(|e| e.to_string())?;
        for ((day, kind, project), count) in batch.events.drain() {
            stmt.execute(rusqlite::params![source_id, day, kind, project, count])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO tool_durations (source_id, day, tool, project_id, duration_ms) VALUES (?1,?2,?3,?4,?5)",
            )
            .map_err(|e| e.to_string())?;
        for (day, tool, project, duration) in batch.durations.drain(..) {
            stmt.execute(rusqlite::params![source_id, day, tool, project, duration])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO rate_samples (source_id, day, provider, model_id, variant, project_id, tps) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            )
            .map_err(|e| e.to_string())?;
        for sample in batch.rates.drain(..) {
            stmt.execute(rusqlite::params![
                source_id,
                sample.day,
                sample.provider,
                sample.model_id,
                sample.variant,
                sample.project_id,
                sample.tps
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_errors (source_id, day, scope, name, message, project_id, count) \
             VALUES (?1,?2,?3,?4,?5,?6,?7) \
             ON CONFLICT(source_id, day, scope, name, message, project_id) DO UPDATE SET \
             count = count + excluded.count",
        ).map_err(|e| e.to_string())?;
        for ((day, scope, name, message, project), count) in batch.errors.drain() {
            stmt.execute(rusqlite::params![source_id, day, scope, name, message, project, count])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_files (source_id, day, path, project_id, reads, edits, writes) \
             VALUES (?1,?2,?3,?4,?5,?6,?7) \
             ON CONFLICT(source_id, day, path, project_id) DO UPDATE SET \
             reads = reads + excluded.reads, edits = edits + excluded.edits, \
             writes = writes + excluded.writes",
        ).map_err(|e| e.to_string())?;
        for ((day, path, project), agg) in batch.files.drain() {
            stmt.execute(rusqlite::params![
                source_id, day, path, project, agg.reads, agg.edits, agg.writes
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT INTO fact_tool_calls (source_id, session_id, tool, input_hash, day, project_id, calls) \
             VALUES (?1,?2,?3,?4,?5,?6,?7) \
             ON CONFLICT(source_id, session_id, tool, input_hash) DO UPDATE SET \
             calls = calls + excluded.calls",
        ).map_err(|e| e.to_string())?;
        for ((session_id, tool, hash), (day, project, calls)) in batch.tool_calls.drain() {
            stmt.execute(rusqlite::params![
                source_id, session_id, tool, hash, day, project, calls
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO usage_sample (source_id, msg_id, ts, provider, model_id, cost, \
                 tok_input, tok_output, tok_cache_read, tok_cache_write) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) \
                 ON CONFLICT(source_id, msg_id) DO UPDATE SET \
                 cost = excluded.cost, tok_input = excluded.tok_input, \
                 tok_output = excluded.tok_output, tok_cache_read = excluded.tok_cache_read, \
                 tok_cache_write = excluded.tok_cache_write",
            )
            .map_err(|e| e.to_string())?;
        for sample in batch.samples.drain(..) {
            stmt.execute(rusqlite::params![
                source_id,
                sample.msg_id,
                sample.ts,
                sample.provider,
                sample.model_id,
                sample.cost,
                sample.tokens[0],
                sample.tokens[1],
                sample.tokens[2],
                sample.tokens[3],
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO pending (source_id, kind, id, time_created) VALUES (?1,?2,?3,?4) \
                 ON CONFLICT(source_id, kind, id) DO NOTHING",
            )
            .map_err(|e| e.to_string())?;
        for (kind, id, ts) in batch.pending_add.drain(..) {
            stmt.execute(rusqlite::params![source_id, kind, id, ts])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = tx
            .prepare_cached("DELETE FROM pending WHERE source_id = ?1 AND kind = ?2 AND id = ?3")
            .map_err(|e| e.to_string())?;
        for (kind, id) in batch.pending_del.drain(..) {
            stmt.execute(rusqlite::params![source_id, kind, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

fn load_projects(
    source: &Connection,
    cache: &Connection,
    source_id: i64,
) -> Result<HashMap<String, String>, String> {
    let mut stmt = source
        .prepare("SELECT id, project_id, directory FROM session")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    let mut dirs: Vec<String> = Vec::new();
    for row in rows {
        let (id, project, directory) = row.map_err(|e| e.to_string())?;
        if project == "global" {
            if !dirs.contains(&directory) {
                dirs.push(directory.clone());
            }
            map.insert(id, format!("dir:{directory}"));
        } else {
            map.insert(id, project);
        }
    }
    for directory in dirs {
        cache
            .execute(
                "INSERT INTO project_dim (source_id, project_id, name, worktree) VALUES (?1, ?2, '', ?3) \
                 ON CONFLICT(source_id, project_id) DO UPDATE SET worktree = excluded.worktree",
                rusqlite::params![source_id, format!("dir:{directory}"), directory],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(map)
}

fn sync_project_dim(source: &Connection, cache: &Connection, source_id: i64) -> Result<(), String> {
    let mut stmt = source
        .prepare("SELECT id, COALESCE(name,''), COALESCE(worktree,'') FROM project")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, name, worktree) = row.map_err(|e| e.to_string())?;
        cache
            .execute(
                "INSERT INTO project_dim (source_id, project_id, name, worktree) VALUES (?1,?2,?3,?4) \
                 ON CONFLICT(source_id, project_id) DO UPDATE SET name = excluded.name, worktree = excluded.worktree",
                rusqlite::params![source_id, id, name, worktree],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sentinel_ok(
    source: &Connection,
    table: &str,
    watermark: i64,
    scanned: i64,
) -> Result<bool, String> {
    if watermark == 0 {
        return Ok(true);
    }
    let count: i64 = source
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE rowid <= ?1"),
            [watermark],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count == scanned)
}

fn recheck_pending(
    manager: &CacheManager,
    source: &Connection,
    cache: &Connection,
    source_id: i64,
    projects: &HashMap<String, String>,
    now: i64,
) -> Result<u64, String> {
    let mut ingested = 0u64;
    for (kind, projection) in [("msg", MSG_PROJECTION), ("part", PART_PROJECTION)] {
        let ids: Vec<String> = {
            let mut stmt = cache
                .prepare("SELECT id FROM pending WHERE source_id = ?1 AND kind = ?2")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![source_id, kind], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for chunk in ids.chunks(500) {
            if manager.interrupt.load(Ordering::SeqCst) {
                return Ok(ingested);
            }
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("{projection} WHERE id IN ({placeholders})");
            let mut batch = Batch::default();
            let mut found: Vec<String> = Vec::new();
            {
                let mut stmt = source.prepare(&sql).map_err(|e| e.to_string())?;
                if kind == "msg" {
                    let rows = stmt
                        .query_map(rusqlite::params_from_iter(chunk), map_msg_row)
                        .map_err(|e| e.to_string())?;
                    for row in rows {
                        let row = row.map_err(|e| e.to_string())?;
                        found.push(row.id.clone());
                        if ingest_message(&row, false, now, projects, &mut batch) {
                            batch.pending_del.push((kind.to_string(), row.id));
                            ingested += 1;
                        }
                    }
                } else {
                    let rows = stmt
                        .query_map(rusqlite::params_from_iter(chunk), map_part_row)
                        .map_err(|e| e.to_string())?;
                    for row in rows {
                        let row = row.map_err(|e| e.to_string())?;
                        found.push(row.id.clone());
                        if ingest_part(&row, false, now, projects, &mut batch) {
                            batch.pending_del.push((kind.to_string(), row.id));
                            ingested += 1;
                        }
                    }
                }
            }
            for id in chunk {
                if !found.contains(id) {
                    batch.pending_del.push((kind.to_string(), id.clone()));
                }
            }
            flush(cache, source_id, &mut batch)?;
        }
    }
    Ok(ingested)
}

fn scan_table(
    manager: &CacheManager,
    source: &Connection,
    cache: &Connection,
    source_id: i64,
    path: &str,
    kind: &str,
    projects: &HashMap<String, String>,
    now: i64,
) -> Result<u64, String> {
    let (projection, watermark_col, scanned_col) = if kind == "msg" {
        (MSG_PROJECTION, "msg_watermark", "msg_scanned")
    } else {
        (PART_PROJECTION, "part_watermark", "part_scanned")
    };
    let mut watermark: i64 = cache
        .query_row(
            &format!("SELECT {watermark_col} FROM source WHERE id = ?1"),
            [source_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut ingested = 0u64;
    loop {
        if manager.interrupt.load(Ordering::SeqCst) {
            break;
        }
        let sql = format!("{projection} WHERE rowid > ?1 ORDER BY rowid LIMIT {BATCH_SIZE}");
        let mut batch = Batch::default();
        let mut scanned = 0i64;
        let mut last_rowid = watermark;
        {
            let mut stmt = source.prepare(&sql).map_err(|e| e.to_string())?;
            if kind == "msg" {
                let rows = stmt
                    .query_map([watermark], map_msg_row)
                    .map_err(|e| e.to_string())?;
                for row in rows {
                    let row = row.map_err(|e| e.to_string())?;
                    scanned += 1;
                    last_rowid = row.rowid;
                    if ingest_message(&row, false, now, projects, &mut batch) {
                        ingested += 1;
                    } else {
                        batch
                            .pending_add
                            .push((kind.to_string(), row.id, row.time_created));
                    }
                }
            } else {
                let rows = stmt
                    .query_map([watermark], map_part_row)
                    .map_err(|e| e.to_string())?;
                for row in rows {
                    let row = row.map_err(|e| e.to_string())?;
                    scanned += 1;
                    last_rowid = row.rowid;
                    if ingest_part(&row, false, now, projects, &mut batch) {
                        ingested += 1;
                    } else {
                        batch
                            .pending_add
                            .push((kind.to_string(), row.id, row.time_created));
                    }
                }
            }
        }
        if scanned == 0 {
            break;
        }
        flush(cache, source_id, &mut batch)?;
        cache
            .execute(
                &format!(
                    "UPDATE source SET {watermark_col} = ?1, {scanned_col} = {scanned_col} + ?2 WHERE id = ?3"
                ),
                rusqlite::params![last_rowid, scanned, source_id],
            )
            .map_err(|e| e.to_string())?;
        watermark = last_rowid;
        if let Ok(mut building) = manager.building.lock() {
            *building.entry(path.to_string()).or_default() += scanned as u64;
        }
        if (scanned as usize) < BATCH_SIZE {
            break;
        }
    }
    Ok(ingested)
}

pub fn refresh_source(manager: &CacheManager, path: &str) -> Result<u64, String> {
    let cache = manager.open()?;
    let source_id = manager.source_id(&cache, path)?;
    let source = db::open_readonly(path)?;
    let now = chrono::Utc::now().timestamp_millis();

    let (msg_wm, part_wm, msg_scanned, part_scanned): (i64, i64, i64, i64) = cache
        .query_row(
            "SELECT msg_watermark, part_watermark, msg_scanned, part_scanned FROM source WHERE id = ?1",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    if !sentinel_ok(&source, "message", msg_wm, msg_scanned)?
        || !sentinel_ok(&source, "part", part_wm, part_scanned)?
    {
        manager.wipe_source(&cache, source_id)?;
    }

    manager
        .building
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path.to_string(), 0);

    let result = (|| {
        sync_project_dim(&source, &cache, source_id)?;
        let projects = load_projects(&source, &cache, source_id)?;
        let mut ingested = recheck_pending(manager, &source, &cache, source_id, &projects, now)?;
        ingested += scan_table(
            manager, &source, &cache, source_id, path, "msg", &projects, now,
        )?;
        ingested += scan_table(
            manager, &source, &cache, source_id, path, "part", &projects, now,
        )?;
        cache
            .execute(
                "DELETE FROM usage_sample WHERE source_id = ?1 AND ts < ?2",
                rusqlite::params![source_id, now - SAMPLE_RETENTION_MS],
            )
            .map_err(|e| e.to_string())?;
        cache
            .execute(
                "UPDATE source SET time_refreshed = ?1 WHERE id = ?2",
                rusqlite::params![now, source_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(ingested)
    })();

    if let Ok(mut building) = manager.building.lock() {
        building.remove(path);
    }
    result
}

pub fn refresh_all(manager: &CacheManager, paths: &[String]) -> u64 {
    manager.interrupt.store(false, Ordering::SeqCst);
    manager.refreshing.store(true, Ordering::SeqCst);
    let mut total = 0u64;
    for path in paths {
        if manager.interrupt.load(Ordering::SeqCst) {
            break;
        }
        match refresh_source(manager, path) {
            Ok(ingested) => total += ingested,
            Err(err) => log::warn!("cache refresh failed for {path}: {err}"),
        }
    }
    if total > 0 {
        manager.ingest_epoch.fetch_add(total, Ordering::SeqCst);
    }
    manager.refreshing.store(false, Ordering::SeqCst);
    total
}
