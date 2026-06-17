//! `topup` — make the wallet ready to trade.
//!
//! Wraps ETH into WETH up to the floor and approves the vault relayer, both
//! idempotently (a no-op when already satisfied). This is the treasury
//! preflight the daemon runs each tick, exposed as a one-shot operator command.
//! Requires `COW_BOT_WRITE=yes`.

use tracing::info;

use crate::config::BotConfig;
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::treasury::Treasury;
use crate::wallet::BotWallet;

/// Runs the `topup` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if write mode or the wallet is not
/// configured, or a typed SDK error if a funding transaction fails.
pub async fn run(config: &BotConfig) -> CmdResult {
    if !config.write_enabled {
        return Err(CommandError::Missing(
            "COW_BOT_WRITE=yes (topup sends transactions)".to_owned(),
        ));
    }
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }

    let findings = FindingsStream::open(&config.findings_dir)?;
    let wallet = BotWallet::build(config).await?;
    let signer = wallet.signer().await?;

    info!("topup: ensuring the wallet is funded and approved");
    Treasury::with_defaults()
        .ensure_ready(&wallet, &signer, config)
        .await?;

    findings.emit(&Finding {
        ts: chrono::Utc::now(),
        severity: Severity::Info,
        category: "topup",
        name: "ready",
        message: "wallet funded and relayer approved".to_owned(),
        detail: None,
    });
    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}
