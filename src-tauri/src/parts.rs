use serde::Serialize;

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolStat {
    pub tool: String,
    pub calls: i64,
    pub completed: i64,
    pub errors: i64,
    pub p50_duration_ms: Option<f64>,
    pub p95_duration_ms: Option<f64>,
    pub total_duration_ms: f64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillStat {
    pub skill: String,
    pub loads: i64,
    pub via_task: i64,
    pub direct: i64,
    pub sessions: i64,
    pub projects: i64,
    pub first_used: i64,
    pub last_used: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityReport {
    pub errors: Vec<ErrorStat>,
    pub compactions_auto: i64,
    pub compactions_manual: i64,
    pub compactions_overflow: i64,
    pub retries: i64,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorStat {
    pub name: String,
    pub count: i64,
}
