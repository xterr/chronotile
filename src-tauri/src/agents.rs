//! Agent identity.
//!
//! opencode records `agent` as a free-text *display name* — there is no id to
//! fall back on. Agent packs rename themselves across releases, and some names
//! carry zero-width-space prefixes (used to force ordering in pickers), so a
//! single agent can appear under half a dozen spellings that all look identical
//! on screen while splitting its cost across six rows.
//!
//! Normalisation here is deliberately conservative: invisible characters, stray
//! whitespace and case only. It will merge `Sisyphus - Ultraworker` with a
//! zero-width-prefixed copy of itself, but it will not touch `Sisyphus-Junior`
//! or `Planner-Sisyphus`, which are genuinely different agents that any
//! suffix-stripping heuristic would silently fold together. Renames that only a
//! human can recognise — `Atlas (Plan Executor)` becoming `Atlas - Plan
//! Executor` — are left to the user-editable alias map instead of guessed at.

/// Zero-width and bidirectional formatting characters observed in real agent
/// names, plus the BOM. These render as nothing, so a name carrying them is
/// indistinguishable on screen from one that does not.
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{200B}'
            | '\u{200C}'
            | '\u{200D}'
            | '\u{200E}'
            | '\u{200F}'
            | '\u{2060}'
            | '\u{FEFF}'
            | '\u{00AD}'
    ) || c.is_control()
}

/// Display form: invisibles removed and whitespace collapsed, but original case
/// preserved so the name still reads the way the agent author wrote it.
pub fn clean_display(raw: &str) -> String {
    let stripped: String = raw.chars().filter(|c| !is_invisible(*c)).collect();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Grouping key. Case-insensitive on top of [`clean_display`], because the same
/// agent is written `sisyphus` and `Sisyphus` across opencode versions.
pub fn normalize_key(raw: &str) -> String {
    let display = clean_display(raw);
    if display.is_empty() {
        return "unknown".to_string();
    }
    display.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_zero_width_prefixes_seen_in_real_data() {
        assert_eq!(
            normalize_key("\u{200B}Sisyphus - Ultraworker"),
            normalize_key("Sisyphus - Ultraworker")
        );
        assert_eq!(
            normalize_key("\u{200B}\u{200B}\u{200B}\u{200B}Atlas - Plan Executor"),
            normalize_key("Atlas - Plan Executor")
        );
    }

    #[test]
    fn folds_case_variants_from_successive_opencode_versions() {
        assert_eq!(normalize_key("sisyphus"), normalize_key("Sisyphus"));
        assert_eq!(
            normalize_key("Sisyphus - ultraworker"),
            normalize_key("Sisyphus - Ultraworker")
        );
    }

    /// The distinction this normaliser must never lose: Sisyphus-Junior is the
    /// single largest agent in a real database and is not a spelling of
    /// Sisyphus. Any suffix-stripping heuristic would merge them.
    #[test]
    fn keeps_genuinely_different_agents_apart() {
        let sisyphus = normalize_key("Sisyphus");
        assert_ne!(normalize_key("Sisyphus-Junior"), sisyphus);
        assert_ne!(normalize_key("Planner-Sisyphus"), sisyphus);
        assert_ne!(normalize_key("Sisyphus - Ultraworker"), sisyphus);
    }

    #[test]
    fn collapses_whitespace_runs_and_trims() {
        assert_eq!(normalize_key("  Atlas   -  Plan Executor "), "atlas - plan executor");
    }

    #[test]
    fn display_keeps_case_but_drops_invisibles() {
        assert_eq!(clean_display("\u{200B}Sisyphus - Ultraworker"), "Sisyphus - Ultraworker");
    }

    #[test]
    fn empty_and_invisible_only_names_fall_back() {
        assert_eq!(normalize_key(""), "unknown");
        assert_eq!(normalize_key("\u{200B}\u{FEFF}"), "unknown");
    }
}
