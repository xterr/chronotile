use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub struct Range {
    pub from: i64,
    pub to: i64,
}

impl Range {
    pub fn new(from: Option<i64>, to: Option<i64>) -> Self {
        Self {
            from: from.unwrap_or(0),
            to: to.unwrap_or(i64::MAX),
        }
    }
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub cost: f64,
    pub tokens: TokenTotals,
    pub messages: i64,
    pub prompts: i64,
    pub sessions: i64,
    pub active_days: i64,
    pub models_used: i64,
    pub tool_calls: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyPoint {
    pub date: String,
    pub cost: f64,
    pub tokens: TokenTotals,
    pub messages: i64,
    pub sessions: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GroupStat {
    pub key: String,
    pub cost: f64,
    pub tokens: TokenTotals,
    pub messages: i64,
    pub sessions: i64,
    pub first_used: i64,
    pub last_used: i64,
    pub p50_output_tps: Option<f64>,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelDailyPoint {
    pub date: String,
    pub key: String,
    pub cost: f64,
    pub total_tokens: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStat {
    pub project_id: String,
    pub name: String,
    pub worktree: String,
    pub cost: f64,
    pub tokens: TokenTotals,
    pub messages: i64,
    pub sessions: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HourlyCell {
    pub weekday: u8,
    pub hour: u8,
    pub count: i64,
}

pub fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted.get(idx).copied()
}
