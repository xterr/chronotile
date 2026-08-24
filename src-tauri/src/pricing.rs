//! Model pricing from [models.dev](https://models.dev).
//!
//! opencode records a `cost` on every message, but only for metered API traffic:
//! subscription and OAuth-plan requests are written with `cost = 0`. On a real
//! database that silently hides the majority of usage, so Chronotile also derives
//! an *estimated* cost from the token counts, which are always recorded.
//!
//! The rates come from models.dev, which is the same source opencode itself
//! prices against — recomputing the metered rows from these numbers reproduces
//! opencode's reported totals exactly. That equality is worth preserving: it
//! makes the estimate directly comparable to the reported figure rather than a
//! parallel invention, and any drift between the two on metered traffic is a
//! reliable signal that the bundled snapshot has gone stale.
//!
//! A snapshot is compiled into the binary so the app is useful offline on first
//! run. Refreshing is explicit and user-initiated: the webview fetches the
//! catalog and hands the raw JSON to [`store`], which trims and persists it.
//! Nothing here ever opens a socket.

use serde::Serialize;
use std::path::{Path, PathBuf};

const BUNDLED: &str = include_str!("../resources/pricing.json");
const FILE_NAME: &str = "pricing.json";

/// Column order of a row in the trimmed catalog. Must stay in sync with
/// `scripts/build-pricing.mjs`.
const FIELDS: [&str; 7] = [
    "provider",
    "model",
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "context",
];

/// Rates are USD per million tokens, verbatim from models.dev.
#[derive(Debug, Clone)]
pub struct ModelPrice {
    pub provider: String,
    pub model: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub context: i64,
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub source: String,
    pub generated: String,
    pub bundled: bool,
    /// Hash of the rates themselves, excluding the fetch timestamp. Two catalogs
    /// downloaded a week apart are usually byte-identical in content, and this is
    /// what lets a refresh skip the write and — far more importantly — skip
    /// invalidating every cached query in the dashboard.
    pub digest: u64,
    pub models: Vec<ModelPrice>,
}

fn digest_of(models: &[ModelPrice]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for model in models {
        model.provider.hash(&mut hasher);
        model.model.hash(&mut hasher);
        model.input.to_bits().hash(&mut hasher);
        model.output.to_bits().hash(&mut hasher);
        model.cache_read.to_bits().hash(&mut hasher);
        model.cache_write.to_bits().hash(&mut hasher);
        model.context.hash(&mut hasher);
    }
    hasher.finish()
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PricingStatus {
    pub source: String,
    pub generated: String,
    pub bundled: bool,
    pub models: i64,
    /// Hours since this catalog was fetched, or None for the bundled snapshot
    /// whose age is the build date rather than anything the user did.
    pub age_hours: Option<i64>,
    /// Set when a refresh actually changed a rate. The dashboard only needs to
    /// drop its cached queries in that case.
    pub changed: bool,
    /// Distinct provider/model pairs seen in the data that the catalog cannot
    /// price. Surfaced so an estimate is never quietly wrong.
    pub unpriced_models: Vec<String>,
}

fn override_path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

fn number(value: Option<&serde_json::Value>) -> f64 {
    value.and_then(serde_json::Value::as_f64).unwrap_or(0.0)
}

/// Parses the trimmed, positional-row format written by `build-pricing.mjs` and
/// by [`store`].
fn parse(raw: &str, bundled: bool) -> Result<Catalog, String> {
    let root: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let fields: Vec<&str> = root
        .get("fields")
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default();
    if fields != FIELDS {
        return Err(format!(
            "pricing catalog has fields {fields:?}, expected {FIELDS:?}"
        ));
    }
    let rows = root
        .get("models")
        .and_then(serde_json::Value::as_array)
        .ok_or("pricing catalog has no models array")?;
    let mut models = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(row) = row.as_array() else { continue };
        let (Some(provider), Some(model)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        models.push(ModelPrice {
            provider: provider.to_string(),
            model: model.to_string(),
            input: number(row.get(2)),
            output: number(row.get(3)),
            cache_read: number(row.get(4)),
            cache_write: number(row.get(5)),
            context: row.get(6).and_then(serde_json::Value::as_i64).unwrap_or(0),
        });
    }
    if models.is_empty() {
        return Err("pricing catalog is empty".to_string());
    }
    Ok(Catalog {
        digest: digest_of(&models),
        source: root
            .get("source")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        generated: root
            .get("generated")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        bundled,
        models,
    })
}

/// The user-refreshed catalog when one is present and parses, otherwise the
/// snapshot compiled into the binary. A corrupt override never breaks startup —
/// it is logged and the bundled copy is used instead.
pub fn load(data_dir: &Path) -> Catalog {
    match std::fs::read_to_string(override_path(data_dir)) {
        Ok(raw) => match parse(&raw, false) {
            Ok(catalog) => return catalog,
            Err(err) => log::warn!("ignoring saved pricing catalog: {err}"),
        },
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            log::warn!("could not read saved pricing catalog: {err}");
        }
        Err(_) => {}
    }
    parse(BUNDLED, true).expect("bundled pricing catalog must parse")
}

/// Trims a raw models.dev `api.json` down to the fields Chronotile prices with
/// and persists it. Mirrors `scripts/build-pricing.mjs` so a refreshed catalog
/// is byte-compatible with the bundled one.
/// Returns the stored catalog and whether any rate actually differs from what
/// was already on disk. An unchanged fetch is the common case — providers
/// reprice rarely — and callers use this to avoid pointless work.
pub fn store(data_dir: &Path, raw_api_json: &str) -> Result<(Catalog, bool), String> {
    let previous = std::fs::read_to_string(override_path(data_dir))
        .ok()
        .and_then(|raw| parse(&raw, false).ok())
        .map(|catalog| catalog.digest);
    let root: serde_json::Value = serde_json::from_str(raw_api_json).map_err(|e| e.to_string())?;
    let providers = root
        .as_object()
        .ok_or("models.dev catalog is not a JSON object")?;

    let mut rows: Vec<(String, String, serde_json::Value)> = Vec::new();
    for (provider_id, provider) in providers {
        let Some(models) = provider.get("models").and_then(serde_json::Value::as_object) else {
            continue;
        };
        for (model_id, model) in models {
            let Some(cost) = model.get("cost") else {
                continue;
            };
            if cost.get("input").and_then(serde_json::Value::as_f64).is_none() {
                continue;
            }
            let context = model
                .get("limit")
                .and_then(|limit| limit.get("context"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);
            rows.push((
                provider_id.clone(),
                model_id.clone(),
                serde_json::json!([
                    provider_id,
                    model_id,
                    number(cost.get("input")),
                    number(cost.get("output")),
                    number(cost.get("cache_read")),
                    number(cost.get("cache_write")),
                    context,
                ]),
            ));
        }
    }
    if rows.is_empty() {
        return Err("no priced models in the fetched catalog".to_string());
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let document = serde_json::json!({
        "source": root.get("__source").and_then(serde_json::Value::as_str).unwrap_or("https://models.dev/api.json"),
        "generated": chrono::Utc::now().to_rfc3339(),
        "fields": FIELDS,
        "models": rows.into_iter().map(|(_, _, row)| row).collect::<Vec<_>>(),
    });
    let serialized = serde_json::to_string(&document).map_err(|e| e.to_string())?;
    let parsed = parse(&serialized, false)?;
    let changed = previous != Some(parsed.digest);
    if !changed {
        // Same rates as the copy already on disk: rewriting it would only move
        // the timestamp, and the caller would have no reason to act on it.
        return Ok((parsed, false));
    }

    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    // Write-then-rename so a failure midway cannot leave a half-written catalog
    // that would fall back to bundled on next launch with no explanation.
    let temp = override_path(data_dir).with_extension("json.tmp");
    std::fs::write(&temp, &serialized).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, override_path(data_dir)).map_err(|e| e.to_string())?;

    Ok((parsed, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_parses_and_prices_a_known_model() {
        let catalog = parse(BUNDLED, true).expect("bundled catalog parses");
        let opus = catalog
            .models
            .iter()
            .find(|m| m.provider == "anthropic" && m.model.starts_with("claude-opus"))
            .expect("anthropic opus pricing is present");
        assert!(opus.input > 0.0, "input rate should be populated");
        assert!(opus.context > 0, "context limit should be populated");
    }

    #[test]
    fn parse_rejects_a_catalog_whose_columns_moved() {
        let raw = r#"{"fields":["provider","model"],"models":[["a","b"]]}"#;
        assert!(parse(raw, false).is_err());
    }

    #[test]
    fn store_trims_a_models_dev_payload() {
        let dir = std::env::temp_dir().join(format!("chronotile-pricing-{}", std::process::id()));
        let raw = r#"{"anthropic":{"models":{"claude-x":{"cost":{"input":5,"output":25,"cache_read":0.5,"cache_write":6.25},"limit":{"context":1000}}}}}"#;
        let (catalog, changed) = store(&dir, raw).expect("stores");
        assert_eq!(catalog.models.len(), 1);
        assert_eq!(catalog.models[0].output, 25.0);
        assert_eq!(catalog.models[0].context, 1000);
        assert!(!catalog.bundled);
        assert!(changed, "a first fetch is always a change");

        let (_, again) = store(&dir, raw).expect("re-stores");
        assert!(!again, "identical rates must not report a change");

        let repriced = raw.replace("\"input\":5", "\"input\":7");
        let (_, after) = store(&dir, &repriced).expect("stores new rate");
        assert!(after, "a changed rate must report a change");
        let _ = std::fs::remove_dir_all(&dir);
    }
}


