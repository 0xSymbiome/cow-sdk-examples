//! `daemon` — the autonomous trading loop.
//!
//! Each tick:
//! 1. **Treasury preflight** — ensure the wallet is funded and approved.
//! 2. **World snapshot** — read balances + allowance.
//! 3. **Plan** — `Strategy::on_tick` emits intents.
//! 4. **Gate + execute** — the risk engine allows or rejects each intent; allowed
//!    intents post a market order and poll to terminal; the portfolio records the
//!    outcome.
//!
//! State persists across ticks. Ctrl-C stops cleanly between and within ticks via
//! `Cancellable::cancel_with`. Requires `COW_BOT_WRITE=yes`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use cow_sdk::alloy::AlloyClientSignerHandle;
use cow_sdk::core::{Address, Amount, Cancellable, CancellationToken};
use cow_sdk::orderbook::{ApiContext, CowEnv, OrderUid, OrderbookApi};
use cow_sdk::trading::{TradeParams, Trading};
use tracing::{Instrument, info, info_span, warn};

use crate::cli::DaemonArgs;
use crate::config::{self, BotConfig};
use crate::error::{CmdResult, CommandError};
use crate::findings::{Finding, FindingsStream, Severity};
use crate::portfolio::Portfolio;
use crate::risk::{Decision, RiskConfig, RiskEngine};
use crate::strategy::{self, Intent, Strategy, WorldView};
use crate::treasury::Treasury;
use crate::wallet::BotWallet;

const TICK_INTERVAL: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_secs(6);
const POLL_BUDGET: Duration = Duration::from_secs(30);

/// Runs the `daemon` command.
///
/// # Errors
///
/// Returns [`CommandError::Missing`] if write mode / the wallet / the strategy
/// are not configured, [`CommandError::Cancelled`] on Ctrl-C, or a typed SDK
/// error if engine construction fails.
pub async fn run(args: DaemonArgs, config: &BotConfig, cancel: CancellationToken) -> CmdResult {
    if !config.write_enabled {
        return Err(CommandError::Missing(
            "COW_BOT_WRITE=yes (daemon posts real Sepolia orders)".to_owned(),
        ));
    }
    if !config.wallet_configured() {
        return Err(CommandError::Missing(
            "COW_BOT_RPC_URL and/or COW_BOT_PRIVATE_KEY".to_owned(),
        ));
    }
    let Some(mut strategy) = strategy::build(&args.strategy, config.sell_amount_wei) else {
        return Err(CommandError::Missing(format!(
            "unknown strategy `{}` (one of: taker, twap, dca)",
            args.strategy
        )));
    };

    let findings = FindingsStream::open(&config.findings_dir)?;
    let span = info_span!("daemon", strategy = strategy.name(), cycles = args.cycles);
    daemon_loop(args, config, &cancel, &findings, strategy.as_mut())
        .instrument(span)
        .await
}

/// Mutable per-run loop state, bundled so the per-tick method stays small.
struct LoopState {
    risk: RiskEngine,
    portfolio: Portfolio,
}

async fn daemon_loop(
    args: DaemonArgs,
    config: &BotConfig,
    cancel: &CancellationToken,
    findings: &FindingsStream,
    strategy: &mut dyn Strategy,
) -> CmdResult {
    let daemon = Daemon::build(config).await?;
    let mut state = LoopState {
        risk: RiskEngine::new(RiskConfig::default()),
        portfolio: Portfolio::load(&config.state_dir),
    };

    let mut tick = 0_u32;
    loop {
        if cancel.is_cancelled() {
            return Err(CommandError::Cancelled);
        }
        tick += 1;
        let result = daemon
            .run_tick(tick, config, cancel, findings, &mut state, strategy)
            .instrument(info_span!("tick", tick))
            .await;
        state.portfolio.note_cycle();
        if let Err(err) = state.portfolio.save(&config.state_dir) {
            warn!(error = %err, "portfolio save failed");
        }
        match result {
            Ok(()) => {}
            Err(CommandError::Cancelled) => return Err(CommandError::Cancelled),
            Err(err) => warn!(error = %err, tick, "tick failed; continuing"),
        }

        if args.cycles != 0 && tick >= args.cycles {
            break;
        }
        info!(tick, "sleeping until next tick");
        if tokio::time::timeout(TICK_INTERVAL, cancel.clone().cancelled_owned())
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

/// The constructed trading surface plus the wallet and treasury, built once.
struct Daemon {
    wallet: BotWallet,
    trading: Trading,
    orderbook: Arc<OrderbookApi>,
    signer: AlloyClientSignerHandle,
    owner: Address,
    treasury: Treasury,
}

impl Daemon {
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
            wallet,
            trading,
            orderbook,
            signer,
            owner,
            treasury: Treasury::with_defaults(),
        })
    }

    async fn run_tick(
        &self,
        tick: u32,
        config: &BotConfig,
        cancel: &CancellationToken,
        findings: &FindingsStream,
        state: &mut LoopState,
        strategy: &mut dyn Strategy,
    ) -> CmdResult {
        // 1. Treasury preflight — repair funding; a failure skips the tick.
        if let Err(err) = self
            .treasury
            .ensure_ready(&self.wallet, &self.signer, config)
            .await
        {
            warn!(error = %err, "treasury preflight failed; skipping tick");
            return Ok(());
        }

        // 2. World snapshot.
        let world = WorldView {
            tick,
            weth_balance: self.wallet.balance_of(config::WETH).await?,
            cow_balance: self.wallet.balance_of(config::COW).await?,
            allowance: self
                .wallet
                .allowance(config::WETH, config::VAULT_RELAYER)
                .await?,
        };
        info!(
            tick = world.tick,
            weth_wei = %world.weth_balance,
            cow_wei = %world.cow_balance,
            allowance_wei = %world.allowance,
            "world snapshot"
        );

        // 3. Plan.
        let intents = strategy.on_tick(&world);
        info!(intents = intents.len(), "strategy planned intents");

        // 4. Gate + execute.
        for intent in &intents {
            if cancel.is_cancelled() {
                return Err(CommandError::Cancelled);
            }
            match state
                .risk
                .check(intent, &world.weth_balance, &world.allowance)
            {
                Decision::Reject(reason) => {
                    warn!(category = reason.category(), label = %intent.label, "risk rejected intent");
                    state.portfolio.note_reject();
                    findings.emit(&Finding {
                        ts: chrono::Utc::now(),
                        severity: Severity::Warn,
                        category: "risk",
                        name: reason.category(),
                        message: reason.to_string(),
                        detail: Some(serde_json::json!({ "intent": intent.label })),
                    });
                }
                Decision::Allow => {
                    let filled = self.execute_intent(intent, cancel).await?;
                    state.risk.record_outflow(&intent.sell_amount);
                    let wei = u128::try_from(*intent.sell_amount.as_u256()).unwrap_or(u128::MAX);
                    state
                        .portfolio
                        .record_sell(&intent.sell_token.to_hex_string(), wei);
                    if filled {
                        state.portfolio.note_fill();
                    }
                }
            }
        }
        Ok(())
    }

    /// Posts a market order for `intent` and polls to terminal. Returns whether
    /// the order filled. Daemon orders are left to fill rather than cancelled.
    async fn execute_intent(
        &self,
        intent: &Intent,
        cancel: &CancellationToken,
    ) -> Result<bool, CommandError> {
        // Reconstruct an owned `Amount` through the typed seam (no Copy/Clone bound).
        let sell_amount = Amount::from_u256(*intent.sell_amount.as_u256());
        let trade = TradeParams::new(
            intent.kind,
            intent.sell_token,
            intent.buy_token,
            sell_amount,
        )
        .with_owner(self.owner)
        .with_slippage_bps(intent.slippage_bps);

        let posted = self
            .trading
            .post_swap_order(trade, &self.signer, None)
            .cancel_with(cancel)
            .await
            .map_err(|err| {
                if cancel.is_cancelled() {
                    CommandError::Cancelled
                } else {
                    warn!(retryable = err.is_retryable(), error = %err, "post failed");
                    err.into()
                }
            })?;

        let uid = posted.order_id;
        info!(order_uid = %uid.to_hex_string(), label = %intent.label, "order posted");
        Ok(self.poll_until_terminal(&uid, cancel).await)
    }

    async fn poll_until_terminal(&self, uid: &OrderUid, cancel: &CancellationToken) -> bool {
        let started = Instant::now();
        while started.elapsed() < POLL_BUDGET {
            if cancel.is_cancelled() {
                return false;
            }
            if let Ok(order) = self.orderbook.order(uid).cancel_with(cancel).await
                && order.status.is_terminal()
            {
                let filled = order.status.is_fulfilled();
                info!(order_uid = %uid.to_hex_string(), status = ?order.status, filled, "order terminal");
                return filled;
            }
            let _ = tokio::time::timeout(POLL_INTERVAL, cancel.clone().cancelled_owned()).await;
        }
        false
    }
}
