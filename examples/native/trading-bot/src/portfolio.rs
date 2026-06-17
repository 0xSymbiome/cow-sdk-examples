//! Portfolio — a small per-token volume + lifetime-counter tracker.
//!
//! Persisted to `state/portfolio.json`; the daemon updates it as orders post and
//! fill, and it survives restarts so cumulative stats are not lost. All amounts
//! are wei.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "portfolio.json";

/// Per-token traded volume.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenLeg {
    pub sold_wei: u128,
}

/// Persisted bot bookkeeping.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Portfolio {
    /// Lowercase `0x`-prefixed token address -> traded volume.
    pub tokens: HashMap<String, TokenLeg>,
    pub cycles_total: u64,
    pub fills_observed: u64,
    pub rejects_total: u64,
}

impl Portfolio {
    /// Loads the portfolio, or returns the default if absent or unreadable.
    #[must_use]
    pub fn load(state_dir: &Path) -> Self {
        let path = state_dir.join(FILE);
        std::fs::read_to_string(path)
            .ok()
            .and_then(|body| serde_json::from_str(&body).ok())
            .unwrap_or_default()
    }

    /// Persists the portfolio as pretty JSON.
    ///
    /// # Errors
    ///
    /// Returns an [`std::io::Error`] if the state directory or file cannot be written.
    pub fn save(&self, state_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(state_dir)?;
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(state_dir.join(FILE), json)
    }

    /// Adds `wei` to the sold volume of `token_hex`.
    pub fn record_sell(&mut self, token_hex: &str, wei: u128) {
        let leg = self
            .tokens
            .entry(token_hex.to_ascii_lowercase())
            .or_default();
        leg.sold_wei = leg.sold_wei.saturating_add(wei);
    }

    pub const fn note_cycle(&mut self) {
        self.cycles_total += 1;
    }

    pub const fn note_fill(&mut self) {
        self.fills_observed += 1;
    }

    pub const fn note_reject(&mut self) {
        self.rejects_total += 1;
    }
}
