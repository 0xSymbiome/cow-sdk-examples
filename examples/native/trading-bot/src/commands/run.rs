//! `run` — the trading cycle.
//!
//! One iteration exercises the full lifecycle a market-taking bot touches:
//!
//! 1. **Quote** — `Trading::quote_only`.
//! 2. **Sign + post** — `Trading::post_swap_order` (market-take) or
//!    `post_limit_order` (limit-make): uploads app-data, signs EIP-712, posts.
//! 3. **Persist** — append the UID to `state/open-orders.jsonl`.
//! 4. **Poll** — `OrderbookApi::order` until terminal or the budget expires.
//! 5. **Cancel** — `Trading::offchain_cancel_order` on whatever is still open.
//!
//! Every long-running call is wrapped in `Cancellable::cancel_with(&cancel)` so
//! Ctrl-C unwinds through the `Cancelled` path. Posting requires
//! `COW_BOT_WRITE=yes`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use alloy_primitives::U256;
use cow_sdk::alloy::AlloyClientSignerHandle;
use cow_sdk::core::{Address, Amount, Cancellable, CancellationToken, OrderKind};
use cow_sdk::orderbook::{ApiContext, CowEnv, OrderUid, OrderbookApi};
use cow_sdk::trading::{LimitTradeParams, OrderTraderParams, TradeParams, Trading};
use tracing::{Instrument, info, info_span, warn};

use crate::cli::{RunArgs, Strategy};
use crate::config::{self, BotConfig};
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::state;
use crate::wallet::BotWallet;

const POLL_INTERVAL: Duration = Duration::from_secs(8);
const POLL_BUDGET: Duration = Duration::from_secs(45);
const BETWEEN_CYCLES: Duration = Duration::from_secs(15);

/// Runs the `run` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if write mode or the wallet is not
/// configured, [`CommandError::Cancelled`] on Ctrl-C, or a typed SDK error if a
/// cycle fails terminally.
pub async fn run(args: RunArgs, config: &BotConfig, cancel: CancellationToken) -> CmdResult {
    if !config.write_enabled {
        return Err(CommandError::Missing(
            "COW_BOT_WRITE=yes (run posts real Sepolia orders)".to_owned(),
        ));
    }
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }

    let findings = FindingsStream::open(&config.findings_dir)?;
    let span = info_span!(
        "run",
        strategy = args.strategy.label(),
        cycles = args.cycles
    );
    cycle_loop(args, config, &cancel, &findings)
        .instrument(span)
        .await
}

async fn cycle_loop(
    args: RunArgs,
    config: &BotConfig,
    cancel: &CancellationToken,
    findings: &FindingsStream,
) -> CmdResult {
    let engine = Engine::build(config).await?;

    // Surface any UIDs a prior interrupted run left non-terminal.
    if let Err(err) = engine.reconcile(config, cancel, findings).await {
        warn!(error = %err, "reconciliation failed (continuing)");
    }

    let mut cycle = 0_u32;
    loop {
        if cancel.is_cancelled() {
            return Err(CommandError::Cancelled);
        }
        cycle += 1;
        let outcome = engine
            .single_cycle(&args, config, cancel, findings)
            .instrument(info_span!("cycle", cycle))
            .await;
        match outcome {
            Ok(()) => {}
            Err(CommandError::Cancelled) => return Err(CommandError::Cancelled),
            Err(err) => {
                warn!(error = %err, cycle, "cycle failed; continuing");
                findings.emit(&Finding {
                    ts: chrono::Utc::now(),
                    severity: Severity::Error,
                    category: "run",
                    name: "cycle-failed",
                    message: err.to_string(),
                    detail: Some(serde_json::json!({ "cycle": cycle })),
                });
            }
        }

        if args.cycles != 0 && cycle >= args.cycles {
            break;
        }
        info!(cycle, "sleeping before next cycle");
        // A fired token resolves the timeout early — interruptible sleep.
        if tokio::time::timeout(BETWEEN_CYCLES, cancel.clone().cancelled_owned())
            .await
            .is_ok()
        {
            return Err(CommandError::Cancelled);
        }
    }

    println!();
    println!("findings: {}", findings.path().display());
    Ok(())
}

/// The constructed trading surface, built once and reused across cycles.
struct Engine {
    trading: Trading,
    orderbook: Arc<OrderbookApi>,
    signer: AlloyClientSignerHandle,
    owner: Address,
}

impl Engine {
    async fn build(config: &BotConfig) -> Result<Self, CommandError> {
        let wallet = BotWallet::build(config).await?;
        let signer = wallet.signer().await?;
        let owner = wallet.owner;

        let context = ApiContext::new(config.chain_id, CowEnv::Prod);
        let orderbook = Arc::new(OrderbookApi::builder_from_context(context).build()?);
        let trading = Trading::builder()
            .chain_id(config.chain_id)
            .app_code(config.app_code.as_str())
            .orderbook_shared(orderbook.clone())
            .build()?;

        Ok(Self {
            trading,
            orderbook,
            signer,
            owner,
        })
    }

    async fn single_cycle(
        &self,
        args: &RunArgs,
        config: &BotConfig,
        cancel: &CancellationToken,
        findings: &FindingsStream,
    ) -> CmdResult {
        // `Amount::from(u128)` is the infallible typed constructor — no
        // decimal-string round-trip, nothing to `unwrap` in the hot path.
        let sell_amount = Amount::from(config.sell_amount_wei);
        let trade = TradeParams::new(OrderKind::Sell, config::WETH, config::COW, sell_amount)
            .with_owner(self.owner)
            .with_slippage_bps(50);

        // 1. Quote.
        let quote = self
            .trading
            .quote_only(trade.clone(), None)
            .cancel_with(cancel)
            .await
            .map_err(|err| {
                if cancel.is_cancelled() {
                    CommandError::Cancelled
                } else {
                    warn!(
                        retryable = err.is_retryable(),
                        backoff_secs = ?err.backoff_hint().map(|d| d.as_secs()),
                        error = %err,
                        "quote_only failed"
                    );
                    err.into()
                }
            })?;
        let quoted_buy = quote.quote_response.quote.buy_amount;
        info!(quote_id = ?quote.quote_response.id, buy_wei = %quoted_buy, "quote received");

        // 2. Sign + post (strategy-dependent).
        let posted = match args.strategy {
            Strategy::MarketTake => self
                .trading
                .post_swap_order(trade, &self.signer, None)
                .cancel_with(cancel)
                .await
                .map_err(|err| post_error("post_swap_order", err, cancel))?,
            Strategy::LimitMake => {
                // Ask 1% above the quoted price so the order rests long enough to
                // observe its lifecycle. The 1% crosses the typed `Amount` <-> U256
                // seam only for the division `Amount` does not expose directly.
                let one_percent = Amount::from(*quoted_buy.as_u256() / U256::from(100u16));
                let demand = quoted_buy.saturating_add(one_percent);
                info!(ask_buy_wei = %demand, "limit-make (1% above quote)");
                let limit = LimitTradeParams::new(
                    OrderKind::Sell,
                    config::WETH,
                    config::COW,
                    Amount::from(config.sell_amount_wei),
                    demand,
                );
                self.trading
                    .post_limit_order(limit, &self.signer, None)
                    .cancel_with(cancel)
                    .await
                    .map_err(|err| post_error("post_limit_order", err, cancel))?
            }
        };

        let uid = posted.order_id;
        let uid_hex = uid.to_hex_string();
        info!(order_uid = %uid_hex, "order posted");
        findings.emit(&Finding {
            ts: chrono::Utc::now(),
            severity: Severity::Info,
            category: "run",
            name: "order-posted",
            message: "order accepted by the orderbook".to_owned(),
            detail: Some(serde_json::json!({
                "uid": uid_hex,
                "explorer": format!("https://explorer.cow.fi/sepolia/orders/{uid_hex}"),
            })),
        });

        // 3. Persist so a later run / cancel-all can clean up if interrupted.
        state::record_posted(&config.state_dir, &uid_hex)?;

        // 4. Poll until terminal or budget expiry.
        self.poll_until_terminal(&uid, cancel).await;

        // 5. Off-chain cancel (unless --no-cancel).
        if args.cancel_after {
            self.cancel_order(uid, config, cancel).await;
        }

        Ok(())
    }

    async fn poll_until_terminal(&self, uid: &OrderUid, cancel: &CancellationToken) {
        let started = Instant::now();
        let mut last_status = None;
        while started.elapsed() < POLL_BUDGET {
            if cancel.is_cancelled() {
                return;
            }
            match self.orderbook.order(uid).cancel_with(cancel).await {
                Ok(order) => {
                    let status = format!("{:?}", order.status);
                    if last_status.as_ref() != Some(&status) {
                        info!(order_uid = %uid.to_hex_string(), %status, "order status");
                        last_status = Some(status);
                    }
                    if order.status.is_terminal() {
                        return;
                    }
                }
                Err(err) => warn!(error = %err, "order() failed mid-poll"),
            }
            // Interruptible inter-poll sleep.
            let _ = tokio::time::timeout(POLL_INTERVAL, cancel.clone().cancelled_owned()).await;
        }
    }

    async fn cancel_order(&self, uid: OrderUid, config: &BotConfig, cancel: &CancellationToken) {
        let uid_hex = uid.to_hex_string();
        info!(order_uid = %uid_hex, "off-chain cancel");
        match self
            .trading
            .offchain_cancel_order(&OrderTraderParams::new(uid), &self.signer)
            .cancel_with(cancel)
            .await
        {
            Ok(accepted) => {
                info!(order_uid = %uid_hex, accepted, "off-chain cancel result");
                state::record_cleared(&config.state_dir, &uid_hex);
            }
            Err(err) => warn!(error = %err, "off-chain cancel failed"),
        }
    }

    async fn reconcile(
        &self,
        config: &BotConfig,
        cancel: &CancellationToken,
        findings: &FindingsStream,
    ) -> std::io::Result<()> {
        let outstanding = state::outstanding(&config.state_dir)?;
        if outstanding.is_empty() {
            return Ok(());
        }
        info!(
            count = outstanding.len(),
            "reconciling outstanding UIDs from a prior run"
        );
        for uid_hex in outstanding {
            let Ok(uid) = OrderUid::new(uid_hex.clone()) else {
                warn!(uid = %uid_hex, "reconcile: malformed UID in state log");
                continue;
            };
            match self.orderbook.order(&uid).cancel_with(cancel).await {
                Ok(order) if order.status.is_terminal() => {
                    state::record_cleared(&config.state_dir, &uid_hex);
                }
                Ok(order) => {
                    let status = format!("{:?}", order.status);
                    warn!(uid = %uid_hex, %status, "reconcile: still active");
                    findings.emit(&Finding {
                        ts: chrono::Utc::now(),
                        severity: Severity::Warn,
                        category: "reconcile",
                        name: "uid-still-active",
                        message: format!("UID {uid_hex} is {status} from a prior run"),
                        detail: Some(serde_json::json!({ "uid": uid_hex, "status": status })),
                    });
                }
                Err(err) => warn!(uid = %uid_hex, error = %err, "reconcile: order() failed"),
            }
        }
        Ok(())
    }
}

/// Maps a post error: a fired token becomes [`CommandError::Cancelled`] (exit
/// 130); otherwise the SDK's retry verdict is logged and the typed error
/// propagates. Both post paths return `TradingError`, so this is concrete.
fn post_error(
    op: &str,
    err: cow_sdk::trading::TradingError,
    cancel: &CancellationToken,
) -> CommandError {
    if cancel.is_cancelled() {
        return CommandError::Cancelled;
    }
    warn!(
        op,
        retryable = err.is_retryable(),
        backoff_secs = ?err.backoff_hint().map(|d| d.as_secs()),
        error = %err,
        "post failed"
    );
    err.into()
}
