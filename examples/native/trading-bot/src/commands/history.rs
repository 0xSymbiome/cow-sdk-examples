//! `history` — read-only account history: recent trades and lifetime surplus for
//! the bot wallet. Moves no funds.

use cow_sdk::core::{Cancellable, CancellationToken};
use cow_sdk::orderbook::{ApiContext, CowEnv, OrderbookApi, TradesQuery};
use tracing::info;

use crate::config::BotConfig;
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::wallet::BotWallet;

/// Runs the `history` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if the wallet is not configured,
/// [`CommandError::Cancelled`] on Ctrl-C, or a typed SDK error if a read fails.
pub async fn run(config: &BotConfig, cancel: CancellationToken) -> CmdResult {
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }

    let findings = FindingsStream::open(&config.findings_dir)?;
    let wallet = BotWallet::build(config).await?;
    let owner = wallet.owner;

    let context = ApiContext::new(config.chain_id, CowEnv::Prod);
    let orderbook = OrderbookApi::builder_from_context(context).build()?;

    let trades = match orderbook
        .trades(&TradesQuery::by_owner(owner).with_limit(20))
        .cancel_with(&cancel)
        .await
    {
        Ok(trades) => trades,
        Err(_) if cancel.is_cancelled() => return Err(CommandError::Cancelled),
        Err(err) => return Err(err.into()),
    };
    info!(count = trades.len(), "recent trades for owner");

    let surplus = orderbook.total_surplus(&owner).await?;
    info!(?surplus, "lifetime total surplus");

    findings.emit(&Finding {
        ts: chrono::Utc::now(),
        severity: Severity::Info,
        category: "history",
        name: "summary",
        message: format!("{} recent trades", trades.len()),
        detail: Some(serde_json::json!({
            "owner": owner.to_hex_string(),
            "trades": trades.len(),
        })),
    });
    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}
