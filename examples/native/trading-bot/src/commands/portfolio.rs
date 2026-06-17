//! `portfolio` — print the persisted bot bookkeeping (`state/portfolio.json`):
//! per-token sold volume and lifetime cycle/fill/reject counters. Offline.

use crate::config::BotConfig;
use crate::error::CmdResult;
use crate::portfolio::Portfolio;

/// Runs the `portfolio` command.
///
/// # Errors
///
/// Returns [`crate::error::CommandError::Io`] if the persisted state cannot be
/// serialized for display.
pub fn run(config: &BotConfig) -> CmdResult {
    let portfolio = Portfolio::load(&config.state_dir);
    let rendered = serde_json::to_string_pretty(&portfolio).map_err(std::io::Error::other)?;
    println!("{rendered}");
    Ok(())
}
