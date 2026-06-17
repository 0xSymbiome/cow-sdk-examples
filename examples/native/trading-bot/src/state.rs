//! Append-only open-order state.
//!
//! `run` records each posted order UID to `state/open-orders.jsonl`, then a
//! "cleared" marker once the order is cancelled or settles. A later run (or
//! `cancel-all`) replays the log to find UIDs a previous, interrupted run left
//! open. The log is append-only, so a crash never corrupts prior records.

use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};

const LOG_FILE: &str = "open-orders.jsonl";

/// One line in the state log: exactly one of `posted` / `cleared` is set.
#[derive(Debug, Serialize, Deserialize)]
struct Record {
    ts: chrono::DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    posted: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cleared: Option<String>,
}

/// Records that `uid_hex` was posted.
///
/// # Errors
///
/// Returns an [`std::io::Error`] if the state directory or file cannot be written.
pub fn record_posted(dir: &Path, uid_hex: &str) -> std::io::Result<()> {
    append(
        dir,
        &Record {
            ts: Utc::now(),
            posted: Some(uid_hex.to_owned()),
            cleared: None,
        },
    )
}

/// Records that `uid_hex` was cleared (cancelled or settled). Best-effort: a
/// failure here only loses a state marker, never a trading action, so it is
/// swallowed rather than propagated.
pub fn record_cleared(dir: &Path, uid_hex: &str) {
    let _ = append(
        dir,
        &Record {
            ts: Utc::now(),
            posted: None,
            cleared: Some(uid_hex.to_owned()),
        },
    );
}

/// Returns the UIDs that were posted but not yet cleared.
///
/// # Errors
///
/// Returns an [`std::io::Error`] if the state file exists but cannot be read.
pub fn outstanding(dir: &Path) -> std::io::Result<Vec<String>> {
    let path = dir.join(LOG_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let body = std::fs::read_to_string(&path)?;
    let mut posted: HashSet<String> = HashSet::new();
    let mut cleared: HashSet<String> = HashSet::new();
    for line in body.lines().filter(|line| !line.trim().is_empty()) {
        // A malformed line is skipped rather than failing the whole replay.
        let Ok(record) = serde_json::from_str::<Record>(line) else {
            continue;
        };
        if let Some(uid) = record.posted {
            posted.insert(uid);
        }
        if let Some(uid) = record.cleared {
            cleared.insert(uid);
        }
    }
    Ok(posted.difference(&cleared).cloned().collect())
}

fn append(dir: &Path, record: &Record) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let line = serde_json::to_string(record).map_err(std::io::Error::other)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE))?;
    writeln!(file, "{line}")
}
