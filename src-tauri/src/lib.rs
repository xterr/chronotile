mod agents;
mod cache;
mod db;
mod parts;
mod pricing;
mod session_detail;
mod sessions;
mod sources;
mod stats;

use cache::{CacheManager, CacheStatus};
use db::Profile;
use parts::{ReliabilityReport, SkillStat, ToolStat};
use pricing::PricingStatus;
use sessions::{SessionCursor, SessionPage};
use stats::{DailyPoint, GroupStat, HourlyCell, ModelDailyPoint, Overview, ProjectStat, Range};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;

struct AppState {
    config_dir: PathBuf,
    data_dir: PathBuf,
    cache: Arc<CacheManager>,
}

#[cfg(target_os = "macos")]
const CHECK_UPDATES_MENU_ID: &str = "check-for-updates";
#[cfg(target_os = "macos")]
const CHECK_UPDATES_EVENT: &str = "chronotile://check-for-updates";

/// Setting an application menu replaces the macOS default wholesale, so the
/// standard Edit and Window submenus have to be rebuilt here or the app loses
/// copy, paste and select-all in its text fields.
#[cfg(target_os = "macos")]
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Chronotile")
        .about(Some(AboutMetadata::default()))
        .separator()
        .text(CHECK_UPDATES_MENU_ID, "Check for Updates…")
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
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
    tauri::async_runtime::spawn_blocking(move || {
        let ingested = cache::ingest::refresh_all(&cache_clone, &paths);
        // An ingest can introduce agent spellings the dimension has not seen,
        // so it is rebuilt here rather than only at startup.
        if let Err(err) = cache_clone
            .open()
            .and_then(|conn| cache_clone.sync_agents(&conn))
        {
            log::warn!("could not refresh agent identities: {err}");
        }
        ingested
    })
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

/// Only `path` is rebuilt; other sources keep their watermarks. The ingest
/// lock is held across both the wipe and the re-scan so the background refresh
/// loop can never observe the half-empty cache.
#[tauri::command]
async fn rebuild_cache(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<CacheStatus, String> {
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    {
        let _guard = cache.ingest_lock.lock().await;

        let wipe_cache = cache.clone();
        let wipe_config = config_dir.clone();
        let wipe_path = path.clone();
        blocking(move || {
            db::validate_known_path(&wipe_path, &sources::load(&wipe_config))?;
            let conn = wipe_cache.open()?;
            let source_id = wipe_cache.source_id(&conn, &wipe_path)?;
            wipe_cache.wipe_source(&conn, source_id)
        })
        .await?;

        let ingest_cache = cache.clone();
        let paths = vec![path];
        tauri::async_runtime::spawn_blocking(move || {
            cache::ingest::refresh_all(&ingest_cache, &paths)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(cache.status(&known_paths(&config_dir)))
}

#[tauri::command]
fn get_cache_status(state: tauri::State<AppState>) -> CacheStatus {
    state.cache.status(&known_paths(&state.config_dir))
}

fn pricing_status(
    cache: &CacheManager,
    catalog: &pricing::Catalog,
    changed: bool,
) -> Result<PricingStatus, String> {
    let conn = cache.open()?;
    let age_hours = (!catalog.bundled)
        .then(|| chrono::DateTime::parse_from_rfc3339(&catalog.generated).ok())
        .flatten()
        .map(|at| (chrono::Utc::now() - at.with_timezone(&chrono::Utc)).num_hours());
    Ok(PricingStatus {
        source: catalog.source.clone(),
        generated: catalog.generated.clone(),
        bundled: catalog.bundled,
        models: catalog.models.len() as i64,
        age_hours,
        changed,
        unpriced_models: cache::read::unpriced_models(&conn)?,
    })
}

/// Quota is deliberately not filtered by project or range: a rolling window is a
/// property of the account, and a limit does not care which repository spent it.
#[tauri::command]
async fn get_quota(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    window_hours: i64,
) -> Result<cache::read::QuotaReport, String> {
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let path = db_paths.first().ok_or("no database selected")?;
        db::validate_known_path(path, &sources::load(&config_dir))?;
        let conn = cache.open()?;
        let Some(source_id) = cache::read::resolve_source(&conn, path) else {
            return Ok(cache::read::QuotaReport::default());
        };
        cache::read::quota(
            &conn,
            source_id,
            chrono::Utc::now().timestamp_millis(),
            window_hours,
        )
    })
    .await
}

#[tauri::command]
async fn get_pricing_status(state: tauri::State<'_, AppState>) -> Result<PricingStatus, String> {
    let cache = state.cache.clone();
    let data_dir = state.data_dir.clone();
    blocking(move || pricing_status(&cache, &pricing::load(&data_dir), false)).await
}

/// Takes the raw models.dev payload the webview fetched. Keeping the network
/// call in the frontend is deliberate: the backend stays socket-free, so the
/// app still makes no request the user did not explicitly ask for.
#[tauri::command]
async fn refresh_pricing(
    state: tauri::State<'_, AppState>,
    catalog: String,
) -> Result<PricingStatus, String> {
    let cache = state.cache.clone();
    let data_dir = state.data_dir.clone();
    blocking(move || {
        let (stored, changed) = pricing::store(&data_dir, &catalog)?;
        if changed {
            let conn = cache.open()?;
            cache.sync_prices(&conn, &stored)?;
        }
        pricing_status(&cache, &stored, changed)
    })
    .await
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
        cache::read::group_stats(conn, p, false, false)
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
    normalize_agents: bool,
) -> Result<Vec<GroupStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), move |conn, p| {
        cache::read::group_stats(conn, p, true, normalize_agents)
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
async fn get_skill_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<SkillStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::skill_stats(conn, p)
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
async fn get_session_costs(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<cache::read::SessionCostStats, String> {
    cached_query(
        &state,
        db_paths,
        from,
        to,
        project,
        cache::read::SessionCostStats::default(),
        |conn, p| cache::read::session_costs(conn, p),
    )
    .await
}

/// Not range-filtered: utilisation is measured from the retained per-message
/// samples, which already cover a fixed recent window.
#[tauri::command]
async fn get_context_health(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
) -> Result<cache::read::ContextHealth, String> {
    let cache = state.cache.clone();
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let path = db_paths.first().ok_or("no database selected")?;
        db::validate_known_path(path, &sources::load(&config_dir))?;
        let conn = cache.open()?;
        let Some(source_id) = cache::read::resolve_source(&conn, path) else {
            return Ok(cache::read::ContextHealth::default());
        };
        cache::read::context_health(&conn, source_id, cache::ingest::SAMPLE_RETENTION_DAYS)
    })
    .await
}

#[tauri::command]
async fn get_error_details(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<cache::read::ErrorDetail>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::error_details(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_file_stats(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<cache::read::FileStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::file_stats(conn, p)
    })
    .await
}

#[tauri::command]
async fn get_redundancy(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
) -> Result<Vec<cache::read::RedundancyStat>, String> {
    cached_query(&state, db_paths, from, to, project, Vec::new(), |conn, p| {
        cache::read::redundancy(conn, p)
    })
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

async fn session_query<F>(
    state: &tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    query: F,
) -> Result<SessionPage, String>
where
    F: FnOnce(&rusqlite::Connection, &str) -> Result<SessionPage, String> + Send + 'static,
{
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let path = db_paths.first().ok_or("no database selected")?;
        let customs = sources::load(&config_dir);
        db::validate_known_path(path, &customs)?;
        let profile = db::discover_profiles(&customs)
            .iter()
            .find(|p| p.path == *path)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let conn = db::open_readonly(path)?;
        query(&conn, &profile)
    })
    .await
}

#[tauri::command]
async fn get_session_roots(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
    cursor: Option<SessionCursor>,
    limit: i64,
    inline_children: i64,
) -> Result<SessionPage, String> {
    session_query(&state, db_paths, move |conn, profile| {
        let range = Range::new(from, to);
        sessions::roots(
            conn,
            profile,
            range.from,
            range.to,
            project.as_deref(),
            cursor.as_ref(),
            limit,
            inline_children,
        )
    })
    .await
}

#[tauri::command]
async fn get_session_children(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    parent_id: String,
    cursor: Option<SessionCursor>,
    limit: i64,
) -> Result<SessionPage, String> {
    session_query(&state, db_paths, move |conn, profile| {
        sessions::children(conn, profile, &parent_id, cursor.as_ref(), limit)
    })
    .await
}

#[tauri::command]
async fn search_sessions(
    state: tauri::State<'_, AppState>,
    db_paths: Vec<String>,
    from: Option<i64>,
    to: Option<i64>,
    project: Option<String>,
    query: String,
    cursor: Option<SessionCursor>,
    limit: i64,
) -> Result<SessionPage, String> {
    session_query(&state, db_paths, move |conn, profile| {
        let range = Range::new(from, to);
        sessions::search(
            conn,
            profile,
            range.from,
            range.to,
            project.as_deref(),
            &query,
            cursor.as_ref(),
            limit,
        )
    })
    .await
}

#[tauri::command]
async fn get_session_detail(
    state: tauri::State<'_, AppState>,
    db_path: String,
    session_id: String,
    offset: i64,
    limit: i64,
) -> Result<session_detail::SessionDetailPage, String> {
    let config_dir = state.config_dir.clone();
    blocking(move || {
        db::validate_known_path(&db_path, &sources::load(&config_dir))?;
        let conn = db::open_readonly(&db_path)?;
        session_detail::session_detail(&conn, &session_id, offset, limit)
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu).on_menu_event(|handle, event| {
        use tauri::Emitter;
        if event.id().0.as_str() == CHECK_UPDATES_MENU_ID {
            let _ = handle.emit(CHECK_UPDATES_EVENT, ());
        }
    });

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

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
            // Prices are joined at read time, so loading them here is enough to
            // re-cost the whole history without touching a single fact row.
            match cache.open().and_then(|conn| {
                cache.sync_prices(&conn, &pricing::load(&data_dir))?;
                cache.sync_agents(&conn)
            }) {
                Ok(()) => {}
                Err(err) => log::warn!("could not load pricing or agent identities: {err}"),
            }
            app.manage(AppState {
                config_dir: config_dir.clone(),
                data_dir: data_dir.clone(),
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
            rebuild_cache,
            get_cache_status,
            get_pricing_status,
            get_quota,
            refresh_pricing,
            get_overview,
            get_daily_series,
            get_model_stats,
            get_agent_stats,
            get_model_daily,
            get_project_stats,
            get_hourly_activity,
            get_tool_stats,
            get_skill_stats,
            get_reliability,
            get_error_details,
            get_session_costs,
            get_context_health,
            get_file_stats,
            get_redundancy,
            get_session_roots,
            get_session_children,
            search_sessions,
            get_session_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
