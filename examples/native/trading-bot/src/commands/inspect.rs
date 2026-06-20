//! `inspect` — single-shot health probe.
//!
//! Prints the wallet address, WETH/COW balances, the vault-relayer allowance,
//! orderbook reachability + owner-scoped open orders, and (when
//! `THE_GRAPH_API_KEY` is set) subgraph totals. The operator's first-touch
//! "is the bot wired correctly?" command. Read-only: never posts or cancels.

use cow_sdk::orderbook::{ApiContext, CowEnv, OrderbookApi, OrdersQuery};
use cow_sdk::subgraph::SubgraphApi;
use tracing::{info, warn};

use crate::config::{self, BotConfig};
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::wallet::BotWallet;

/// Runs the `inspect` command.
///
/// # Errors
///
/// Returns [`CommandError`] if the wallet is unconfigured or a required chain /
/// orderbook read fails. Optional reads (open orders, subgraph) degrade to
/// warnings rather than aborting the probe.
pub async fn run(config: &BotConfig) -> CmdResult {
    let findings = FindingsStream::open(&config.findings_dir)?;
    inspect_inner(config, &findings).await
}

#[tracing::instrument(name = "inspect", skip_all, fields(chain = config.chain_id_u64()))]
async fn inspect_inner(config: &BotConfig, findings: &FindingsStream) -> CmdResult {
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }

    let wallet = BotWallet::build(config).await?;
    info!(owner = %wallet.owner.to_hex_string(), "wallet built");

    // WETH + COW balances.
    let weth_balance = wallet.balance_of(config::WETH).await?;
    let cow_balance = wallet.balance_of(config::COW).await?;
    info!(weth_wei = %weth_balance, cow_wei = %cow_balance, "token balances");

    // Vault-relayer allowance for WETH — what an order authorizes the protocol
    // to pull at settlement.
    let allowance = wallet
        .allowance(config::WETH, config::VAULT_RELAYER)
        .await?;
    info!(weth_vault_allowance = %allowance, "vault-relayer allowance (WETH)");

    // Orderbook reachability + owner-scoped open orders.
    let context = ApiContext::new(config.chain_id, CowEnv::Prod);
    let orderbook = OrderbookApi::builder_from_context(context).build()?;

    let version = orderbook.version().await?;
    info!(version = %version, "orderbook reachable");

    let query = OrdersQuery::new(wallet.owner).with_limit(10);
    let (visible, active) = match orderbook.orders(&query).await {
        Ok(orders) => {
            // Active = still live — typed via `OrderStatus::is_open()`.
            let active = orders
                .iter()
                .filter(|order| order.status.is_open())
                .count();
            info!(visible = orders.len(), active, "owner orders");
            (orders.len(), active)
        }
        Err(err) => {
            warn!(error = %err, "orderbook.orders() failed (informational)");
            findings.emit(&Finding {
                ts: chrono::Utc::now(),
                severity: Severity::Warn,
                category: "inspect",
                name: "owner-orders-unavailable",
                message: format!("owner-scoped orders query failed: {err}"),
                detail: None,
            });
            (0, 0)
        }
    };

    // Subgraph totals — optional, only when an API key is configured.
    if let Some(key) = config.the_graph_api_key.as_ref() {
        match SubgraphApi::builder()
            .chain(config.chain_id)
            .api_key(key.as_inner().as_str())
            .build()
        {
            Ok(subgraph) => match subgraph.totals().await {
                Ok(totals) => info!(?totals, "subgraph totals"),
                Err(err) => warn!(error = %err, "subgraph.totals() failed (informational)"),
            },
            Err(err) => warn!(error = %err, "subgraph build failed (informational)"),
        }
    } else {
        info!("subgraph skipped — THE_GRAPH_API_KEY not set");
    }

    findings.emit(&Finding {
        ts: chrono::Utc::now(),
        severity: Severity::Info,
        category: "inspect",
        name: "summary",
        message: "inspect completed".to_owned(),
        detail: Some(serde_json::json!({
            "owner": wallet.owner.to_hex_string(),
            "wethWei": weth_balance.to_string(),
            "cowWei": cow_balance.to_string(),
            "vaultAllowanceWei": allowance.to_string(),
            "ordersVisible": visible,
            "ordersActive": active,
        })),
    });

    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}
