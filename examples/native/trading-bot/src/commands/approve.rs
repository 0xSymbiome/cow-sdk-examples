//! `approve` — set (or revoke with `--amount=0`) the vault-relayer WETH
//! allowance directly. Requires `COW_BOT_WRITE=yes`.

use cow_sdk::core::Amount;
use cow_sdk::orderbook::CowEnv;
use cow_sdk::trading::{ApprovalParams, WaitOptions, approval_transaction};
use tracing::info;

use crate::cli::ApproveArgs;
use crate::config::{self, BotConfig};
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::wallet::BotWallet;

/// Runs the `approve` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if write mode or the wallet is not
/// configured, or a typed SDK error if the approval transaction fails.
pub async fn run(args: ApproveArgs, config: &BotConfig) -> CmdResult {
    if !config.write_enabled {
        return Err(CommandError::Missing(
            "COW_BOT_WRITE=yes (approve sends a transaction)".to_owned(),
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

    let params = ApprovalParams::new(config::WETH, Amount::from(args.amount_wei));
    let tx = approval_transaction(&params, config.chain_id, CowEnv::Prod)?;
    info!(
        amount_wei = args.amount_wei,
        "approve: submitting allowance change"
    );
    wallet
        .submit_and_wait(&signer, &tx, WaitOptions::approve_default())
        .await?;
    info!("approve: allowance updated");

    findings.emit(&Finding {
        ts: chrono::Utc::now(),
        severity: Severity::Info,
        category: "approve",
        name: "allowance-set",
        message: format!("relayer WETH allowance set to {} wei", args.amount_wei),
        detail: Some(serde_json::json!({ "amountWei": args.amount_wei.to_string() })),
    });
    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}
