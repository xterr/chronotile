mod cache;
mod db;
mod parts;
mod session_detail;
mod sessions;
mod sources;
mod stats;

use cache::{CacheManager, CacheStatus};
use db::Profile;
use parts::{ReliabilityReport, ToolStat};
use sessions::SessionRow;
use stats::{DailyPoint, GroupStat, HourlyCell, ModelDailyPoint, Overview, ProjectStat, Range};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;

struct AppState {
    config_dir: PathBuf,
    cache: Arc<CacheManager>,
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn known_paths(config_dir: &std::path::Path) -> Vec<String> {
    db::known_paths(&sources::load(config_dir))
}

async fn run_refresh(cache: Arc<CacheManager>, config_dir: PathBuf) -> u64 {
    let _guard = cache.ingest_lock.lock().await;
    let paths = known_paths(&config_dir);
    let cache_clone = cache.clone();
    tauri::async_runtime::spawn_blocking(move || cache::ingest::refresh_all(&cache_clone, &paths))
        .await
        .unwrap_or(0)
}

async fn cached_query<T, F>(
    state: &tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
    empty: T,
    query: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&rusqlite::Connection, (i64, &str, &str, Option<&str>)) -> Result<T, String>
        + Send
        + 'static,
{
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let path = db_paths.first().ok_or("no database selected")?;
        db::validate_known_path(path, &sources::load(&config_dir))?;
        let conn = cache.open()?;
        let Some(source_id) = cache::read::resolve_source(&conn, path) else {
            return Ok(empty);
        };
        let range = Range::new(from, to);
        let (from_day, to_day) = cache::read::day_bounds(
            (range.from > 0).then_some(range.from),
            (range.to < i64::MAX).then_some(range.to),
        );
        query(&conn, (source_id, &from_day, &to_day, project.as_deref()))
    })
    .await
}

#[tauri::command]
async fn list_profiles(state: tauri::State<'_, AppState>) -> Result<Vec<Profile>, String> {
    let config_dir = state.config_dir.clone();
    blocking(move || Ok(db::discover_profiles(&sources::load(&config_dir)))).await
}

#[tauri::command]
async fn add_database(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Profile, String> {
    let config_dir = state.config_dir.clone();
    let path_clone = path.clone();
    let profile = blocking(move || {
        let profile = db::add_custom_path(&path_clone)?;
        sources::add(&config_dir, &path_clone)?;
        Ok(profile)
    })
    .await?;
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    tauri::async_runtime::spawn(async move {
        run_refresh(cache, config_dir).await;
    });
    Ok(profile)
}

#[tauri::command]
async fn remove_database(state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    let cache = state.cache.clone();
    cache.interrupt.store(true, Ordering::SeqCst);
    let _guard = cache.ingest_lock.lock().await;
    let config_dir = state.config_dir.clone();
    let cache_clone = cache.clone();
    blocking(move || {
        sources::remove(&config_dir, &path)?;
        cache_clone.remove_source(&path)
    })
    .await
}

#[tauri::command]
async fn refresh_cache(state: tauri::State<'_, AppState>) -> Result<CacheStatus, String> {
    run_refresh(state.cache.clone(), state.config_dir.clone()).await;
    Ok(state.cache.status(&known_paths(&state.config_dir)))
}

#[tauri::command]
fn get_cache_status(state: tauri::State<AppState>) -> CacheStatus {
    state.cache.status(&known_paths(&state.config_dir))
}

#[tauri::command]
async fn get_overview(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Overview, String> {
    cached_query(&state, db_paths, from, to, project, Overview::default(), |conn, p| {
        cache::read::overview(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_daily_series(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<DailyPoint>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::daily_series(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_model_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<GroupStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::group_stats(conn, p, false)
    })
    .await
}

#[tauri::command]
async fn get_agent_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<GroupStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::group_stats(conn, p, true)
    })
    .await
}

#[tauri::command]
async fn get_model_daily(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
    group_by: String,
) -> Result<Vec<ModelDailyPoint>, String> {
    let by_agent = group_by == "agent";
    cached_query(&state, db_paths, from, to, project, Vec::new(), move |conn, p| {
        cache::read::group_daily(conn, p, by_agent)
    })
    .await
}

#[tauri::command]
async fn get_project_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<ProjectStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::project_stats(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_hourly_activity(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<HourlyCell>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::hourly_activity(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_tool_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<ToolStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::tool_stats(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_reliability(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<ReliabilityReport, String> {
    cached_query(
        &state,
        db_paths,
        from,
        to,
        project,
        ReliabilityReport::default(),
        |conn, p| cache::read::reliability(conn, p),
    )
    .await
}

#[tauri::command]
async fn list_projects(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
) -> Result<Vec<cache::read::ProjectOption>, String> {
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let path = db_paths.first().ok_or("no database selected")?;
        db::validate_known_path(path, &sources::load(&config_dir))?;
        let conn = cache.open()?;
        let Some(source_id) = cache::read::resolve_source(&conn, path) else {
            return Ok(Vec::new());
        };
        cache::read::list_projects(&conn, source_id)
    })
    .await
}

#[tauri::command]
async fn get_sessions(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
    include_subagents: bool,
    limit: usize,
) -> Result<Vec<SessionRow>, String> {
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let range = Range::new(from, to);
        let customs = sources::load(&config_dir);
        let known = db::discover_profiles(&customs);
        let mut acc = Vec::new();
        for path in &db_paths {
            db::validate_known_path(path, &customs)?;
            let conn = db::open_readonly(path)?;
            let profile = known
                .iter()
                .find(|p| p.path == *path)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| "unknown".to_string());
            sessions::sessions_list(
                &conn,
                &profile,
                range,
                include_subagents,
                project.as_deref(),
                &mut acc,
            )?;
        }
        acc.sort_by(|a, b| b.time_updated.cmp(&a.time_updated));
        acc.truncate(limit.min(1000));
        Ok(acc)
    })
    .await
}

#[tauri::command]
async fn get_session_detail(
    state: tauri::State<'_, AppState>,
    db_path: String,
    session_id: String,
) -> Result<Vec<session_detail::MessageView>, String> {
    let config_dir = state.config_dir.clone();
    blocking(move || {
        db::validate_known_path(&db_path, &sources::load(&config_dir))?;
        let conn = db::open_readonly(&db_path)?;
        session_detail::session_detail(&conn, &session_id)
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let cache = Arc::new(CacheManager::new(&data_dir).map_err(std::io::Error::other)?);
            app.manage(AppState {
                config_dir: config_dir.clone(),
                cache: cache.clone(),
            });
            tauri::async_runtime::spawn(async move {
                loop {
                    run_refresh(cache.clone(), config_dir.clone()).await;
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            list_projects,
            add_database,
            remove_database,
            refresh_cache,
            get_cache_status,
            get_overview,
            get_daily_series,
            get_model_stats,
            get_agent_stats,
            get_model_daily,
            get_project_stats,
            get_hourly_activity,
            get_tool_stats,
            get_reliability,
            get_sessions,
            get_session_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
