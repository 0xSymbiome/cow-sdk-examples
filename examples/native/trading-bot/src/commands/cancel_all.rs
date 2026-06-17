//! `cancel-all` — off-chain cancel every open order belonging to the bot wallet.
//!
//! Walks the orderbook for owner-scoped orders, skips terminal ones (typed via
//! `OrderStatus::is_terminal`), and off-chain-cancels the rest. Off-chain
//! cancellation is a signed message, not a transaction, so it costs no gas.

use std::sync::Arc;

use cow_sdk::core::{Cancellable, CancellationToken};
use cow_sdk::orderbook::{ApiContext, CowEnv, OrderbookApi, OrdersQuery};
use cow_sdk::trading::{OrderTraderParams, Trading};
use tracing::{info, warn};

use crate::config::BotConfig;
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::wallet::BotWallet;

/// Runs the `cancel-all` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if the wallet is unconfigured,
/// [`CommandError::Cancelled`] on Ctrl-C, or a typed SDK error if the owner-order
/// walk fails.
pub async fn run(config: &BotConfig, cancel: CancellationToken) -> CmdResult {
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }
    let findings = FindingsStream::open(&config.findings_dir)?;

    let wallet = BotWallet::build(config).await?;
    let signer = wallet.signer().await?;

    let context = ApiContext::new(config.chain_id, CowEnv::Prod);
    let orderbook = Arc::new(OrderbookApi::builder_from_context(context).build()?);
    let trading = Trading::builder()
        .chain_id(config.chain_id)
        .app_code(config.app_code.as_str())
        .orderbook_shared(orderbook.clone())
        .build()?;

    let query = OrdersQuery::new(wallet.owner).with_limit(100);
    let orders = match orderbook.orders(&query).cancel_with(&cancel).await {
        Ok(orders) => orders,
        Err(_) if cancel.is_cancelled() => return Err(CommandError::Cancelled),
        Err(err) => return Err(err.into()),
    };
    info!(count = orders.len(), "orders found for owner");

    let mut cancelled = 0_u32;
    let mut skipped = 0_u32;
    for order in &orders {
        if order.status.is_terminal() {
            skipped += 1;
            continue;
        }
        if cancel.is_cancelled() {
            return Err(CommandError::Cancelled);
        }
        match trading
            .offchain_cancel_order(&OrderTraderParams::new(order.uid), &signer)
            .cancel_with(&cancel)
            .await
        {
            Ok(accepted) => {
                cancelled += u32::from(accepted);
                info!(uid = %order.uid.to_hex_string(), accepted, "off-chain cancel");
            }
            Err(err) => warn!(uid = %order.uid.to_hex_string(), error = %err, "cancel failed"),
        }
    }

    findings.emit(&Finding {
        ts: chrono::Utc::now(),
        severity: Severity::Info,
        category: "cancel-all",
        name: "summary",
        message: format!(
            "cancelled {cancelled} of {} ({skipped} terminal skipped)",
            orders.len()
        ),
        detail: Some(serde_json::json!({
            "found": orders.len(),
            "cancelled": cancelled,
            "skippedTerminal": skipped,
        })),
    });

    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}
