use std::path::{Path, PathBuf};

fn file(config_dir: &Path) -> PathBuf {
    config_dir.join("sources.json")
}

pub fn load(config_dir: &Path) -> Vec<String> {
    std::fs::read_to_string(file(config_dir))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &Path, paths: &[String]) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(paths).map_err(|e| e.to_string())?;
    std::fs::write(file(config_dir), raw).map_err(|e| e.to_string())
}

pub fn add(config_dir: &Path, path: &str) -> Result<(), String> {
    let mut paths = load(config_dir);
    if !paths.iter().any(|p| p == path) {
        paths.push(path.to_string());
        save(config_dir, &paths)?;
    }
    Ok(())
}

pub fn remove(config_dir: &Path, path: &str) -> Result<(), String> {
    let mut paths = load(config_dir);
    paths.retain(|p| p != path);
    save(config_dir, &paths)
}
