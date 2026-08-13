use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_default: bool,
    pub size_bytes: u64,
    pub sessions: i64,
    pub first_activity: Option<i64>,
    pub last_activity: Option<i64>,
}

pub fn open_readonly(path: &str) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("open {path}: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn default_candidates() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    [
        ".local/share/opencode/opencode.db",
        "Library/Application Support/opencode/opencode.db",
    ]
    .iter()
    .map(|rel| home.join(rel))
    .filter(|p| p.is_file())
    .collect()
}

fn derive_name(path: &Path) -> String {
    let components: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    if let Some(idx) = components.iter().position(|c| c == "profiles") {
        if let Some(profile) = components.get(idx + 1) {
            return profile.clone();
        }
    }
    path.parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "custom".to_string())
}

pub fn probe(name: &str, path: &Path, is_default: bool) -> Result<Profile, String> {
    let path_str = path.to_string_lossy().to_string();
    let conn = open_readonly(&path_str)?;
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0))
        .map_err(|e| format!("not an opencode database ({path_str}): {e}"))?;
    let (first, last): (Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT MIN(time_created), MAX(time_updated) FROM session",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((None, None));
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(Profile {
        id: path_str.clone(),
        name: name.to_string(),
        path: path_str,
        is_default,
        size_bytes,
        sessions,
        first_activity: first,
        last_activity: last,
    })
}

pub fn known_paths(custom_paths: &[String]) -> Vec<String> {
    let mut out: Vec<String> = default_candidates()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    for path in custom_paths {
        if !out.contains(path) && Path::new(path).is_file() {
            out.push(path.clone());
        }
    }
    out
}

pub fn discover_profiles(custom_paths: &[String]) -> Vec<Profile> {
    let mut out: Vec<Profile> = default_candidates()
        .iter()
        .filter_map(|p| probe("default", p, true).ok())
        .collect();
    for raw in custom_paths {
        let path = PathBuf::from(raw);
        if out.iter().any(|existing| existing.path == *raw) {
            continue;
        }
        if let Ok(profile) = probe(&derive_name(&path), &path, false) {
            out.push(profile);
        }
    }
    out
}

pub fn validate_known_path(path: &str, custom_paths: &[String]) -> Result<(), String> {
    let is_default = default_candidates()
        .iter()
        .any(|p| p.to_string_lossy() == path);
    if is_default || custom_paths.iter().any(|p| p == path) {
        Ok(())
    } else {
        Err(format!("unknown database path: {path}"))
    }
}

pub fn add_custom_path(path: &str) -> Result<Profile, String> {
    let pb = PathBuf::from(path);
    if !pb.is_file() {
        return Err(format!("file not found: {path}"));
    }
    probe(&derive_name(&pb), &pb, false)
}
