//! `liveness` — orchestrator health probe.
//!
//! Exits `0` when the RPC and orderbook dependencies are reachable, and a
//! non-zero code otherwise (the propagated typed error maps to `1`). Read-only,
//! shaped for a container liveness/readiness check.

use cow_sdk::orderbook::{ApiContext, CowEnv, OrderbookApi};
use tracing::{info, warn};

use crate::config::BotConfig;
use crate::error::{CmdResult, CommandError};
use crate::wallet::BotWallet;

/// Runs the `liveness` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if the wallet is not configured, or a typed
/// SDK error (mapping to exit `1`) if the RPC or orderbook is unreachable.
pub async fn run(config: &BotConfig) -> CmdResult {
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }

    // RPC health: `build_checked` round-trips `eth_chainId`.
    let wallet = BotWallet::build(config).await?;
    info!(owner = %wallet.owner.to_hex_string(), "rpc reachable");

    // Orderbook health.
    let context = ApiContext::new(config.chain_id, CowEnv::Prod);
    let orderbook = OrderbookApi::builder_from_context(context).build()?;
    let version = orderbook.version().await?;
    info!(version = %version, "orderbook reachable");

    // Subgraph is optional and never fails the probe.
    if config.the_graph_api_key.is_none() {
        warn!("subgraph not configured (THE_GRAPH_API_KEY) — skipped");
    }

    println!("healthy");
    Ok(())
}
