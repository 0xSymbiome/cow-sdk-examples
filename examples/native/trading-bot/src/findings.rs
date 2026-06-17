//! JSONL findings stream.
//!
//! Every notable event (order posted, cancel result, health summary) is appended
//! to `findings/<UTC>.jsonl` — one JSON object per line, append-only so a crash
//! never loses the work so far, and trivial to grep or ship to a log collector.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;
use tracing::error;

/// Severity of a recorded finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warn,
    Error,
}

/// One structured finding line.
#[derive(Debug, Serialize)]
pub struct Finding<'a> {
    pub ts: chrono::DateTime<Utc>,
    pub severity: Severity,
    pub category: &'a str,
    pub name: &'a str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
}

/// An open, append-only findings file for a single run.
pub struct FindingsStream {
    path: PathBuf,
}

impl FindingsStream {
    /// Opens (creating the directory and an empty file if needed) the findings
    /// stream for this run.
    ///
    /// # Errors
    ///
    /// Returns an [`std::io::Error`] if the findings directory or file cannot be
    /// created.
    pub fn open(dir: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
        let path = dir.join(format!("{stamp}.jsonl"));
        // Touch so the file exists even on a zero-finding run.
        OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self { path })
    }

    /// The path of the findings file for this run.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Appends one finding. Serialization or I/O failures are logged rather than
    /// propagated — losing a diagnostic line must never abort a trading action.
    pub fn emit(&self, finding: &Finding<'_>) {
        let line = match serde_json::to_string(finding) {
            Ok(line) => line,
            Err(err) => {
                error!(error = %err, "could not serialize finding");
                return;
            }
        };
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new().append(true).open(&self.path)?;
            writeln!(file, "{line}")
        })();
        if let Err(err) = result {
            error!(error = %err, path = %self.path.display(), "could not write finding");
        }
    }
}
