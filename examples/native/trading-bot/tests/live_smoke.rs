//! Live smoke tests — opt-in, network + wallet required.
//!
//! These are `#[ignore]` so the default `cargo test` (and CI) never runs them.
//! Run them deliberately against a funded Sepolia test wallet:
//!
//! ```text
//! cargo test -p cow-trading-bot -- --ignored
//! ```
//!
//! with `COW_BOT_RPC_URL` + `COW_BOT_PRIVATE_KEY` set (a local `.env` in the
//! crate directory is loaded automatically). They are read-only: no orders, no
//! gas.

use cow_trading_bot::config::{self, BotConfig};
use cow_trading_bot::wallet::BotWallet;

/// Loads the crate-local `.env` if present, mirroring the binary's startup.
fn load_env() {
    let _ = dotenvy::from_path(".env");
}

#[tokio::test]
#[ignore = "live: needs COW_BOT_RPC_URL + COW_BOT_PRIVATE_KEY; run with --ignored"]
async fn wallet_reads_live_balances() {
    load_env();
    let config = BotConfig::from_env().expect("config loads");
    if !config.wallet_configured() {
        eprintln!("skipping: wallet not configured");
        return;
    }

    let wallet = BotWallet::build(&config)
        .await
        .expect("wallet builds against the live RPC");
    let weth = wallet
        .balance_of(config::WETH)
        .await
        .expect("WETH balance read succeeds");
    let allowance = wallet
        .allowance(config::WETH, config::VAULT_RELAYER)
        .await
        .expect("allowance read succeeds");

    println!("live WETH balance: {weth} wei, relayer allowance: {allowance} wei");
}

#[tokio::test]
#[ignore = "live: needs COW_BOT_RPC_URL + COW_BOT_PRIVATE_KEY; run with --ignored"]
async fn orderbook_is_reachable() {
    use cow_sdk::orderbook::{ApiContext, CowEnv, OrderbookApi};

    load_env();
    let config = BotConfig::from_env().expect("config loads");
    if !config.wallet_configured() {
        eprintln!("skipping: wallet not configured");
        return;
    }

    let context = ApiContext::new(config.chain_id, CowEnv::Prod);
    let orderbook = OrderbookApi::builder_from_context(context)
        .build()
        .expect("orderbook builds");
    let version = orderbook
        .version()
        .await
        .expect("orderbook version reachable");
    assert!(!version.is_empty(), "version string is non-empty");
    println!("live orderbook version: {version}");
}
