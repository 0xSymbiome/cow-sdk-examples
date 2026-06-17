//! Unit tests for the bot's own decision logic — pure, deterministic, offline.
//!
//! These test what the bot is responsible for (strategy planning, the risk gate,
//! configuration + credential redaction), not the SDK, which the SDK's own suite
//! covers.

use std::time::Duration;

use cow_sdk::core::{Amount, OrderKind, Redacted, SupportedChainId};
use cow_trading_bot::config::{self, BotConfig, LogFormat};
use cow_trading_bot::risk::{Decision, RejectReason, RiskConfig, RiskEngine};
use cow_trading_bot::strategy::{self, Intent, WorldView};

const ONE_WETH: u128 = 1_000_000_000_000_000_000;

fn flush_world() -> WorldView {
    WorldView {
        tick: 1,
        weth_balance: Amount::from(ONE_WETH),
        cow_balance: Amount::ZERO,
        allowance: Amount::from(ONE_WETH),
    }
}

fn intent_selling(wei: u128) -> Intent {
    Intent {
        kind: OrderKind::Sell,
        sell_token: config::WETH,
        buy_token: config::COW,
        sell_amount: Amount::from(wei),
        slippage_bps: 50,
        label: "test".to_owned(),
    }
}

// ---------- strategy ----------

#[test]
fn taker_emits_one_market_sell_of_the_configured_size() {
    let mut taker = strategy::build("taker", 5_000_000_000_000_000).expect("taker strategy exists");
    let intents = taker.on_tick(&flush_world());
    assert_eq!(intents.len(), 1);
    assert_eq!(intents[0].sell_token, config::WETH);
    assert_eq!(intents[0].buy_token, config::COW);
    assert_eq!(
        intents[0].sell_amount,
        Amount::from(5_000_000_000_000_000_u128)
    );
}

#[test]
fn twap_splits_the_budget_into_four_slices_then_stops() {
    let mut twap = strategy::build("twap", 8).expect("twap strategy exists");
    for slice in 0..4 {
        let intents = twap.on_tick(&flush_world());
        assert_eq!(intents.len(), 1, "slice {slice} should emit one intent");
        assert_eq!(
            intents[0].sell_amount,
            Amount::from(2_u128),
            "8 wei / 4 slices = 2"
        );
    }
    assert!(
        twap.on_tick(&flush_world()).is_empty(),
        "twap stops after its slices"
    );
}

#[test]
fn dca_emits_on_every_tick() {
    let mut dca = strategy::build("dca", 3).expect("dca strategy exists");
    assert_eq!(dca.on_tick(&flush_world()).len(), 1);
    assert_eq!(dca.on_tick(&flush_world()).len(), 1);
}

#[test]
fn unknown_strategy_is_none() {
    assert!(strategy::build("does-not-exist", 1).is_none());
}

// ---------- risk gate ----------

#[test]
fn risk_allows_a_funded_intent() {
    let mut risk = RiskEngine::new(RiskConfig::default());
    let funded = Amount::from(ONE_WETH);
    let decision = risk.check(&intent_selling(5_000_000_000_000_000), &funded, &funded);
    assert!(matches!(decision, Decision::Allow));
}

#[test]
fn risk_rejects_insufficient_balance() {
    let mut risk = RiskEngine::new(RiskConfig::default());
    let funded = Amount::from(ONE_WETH);
    let decision = risk.check(&intent_selling(ONE_WETH), &Amount::ZERO, &funded);
    assert!(matches!(
        decision,
        Decision::Reject(RejectReason::InsufficientBalance { .. })
    ));
}

#[test]
fn risk_rejects_insufficient_allowance() {
    let mut risk = RiskEngine::new(RiskConfig::default());
    let funded = Amount::from(ONE_WETH);
    let decision = risk.check(&intent_selling(ONE_WETH), &funded, &Amount::ZERO);
    assert!(matches!(
        decision,
        Decision::Reject(RejectReason::InsufficientAllowance { .. })
    ));
}

#[test]
fn risk_rate_limits_back_to_back_intents() {
    let mut risk = RiskEngine::new(RiskConfig::default());
    let funded = Amount::from(ONE_WETH);
    let intent = intent_selling(5_000_000_000_000_000);
    assert!(matches!(
        risk.check(&intent, &funded, &funded),
        Decision::Allow
    ));
    assert!(matches!(
        risk.check(&intent, &funded, &funded),
        Decision::Reject(RejectReason::RateLimited { .. })
    ));
}

#[test]
fn risk_caps_cumulative_position() {
    let mut risk = RiskEngine::new(RiskConfig {
        max_position_wei: 5,
        min_tick_interval: Duration::from_secs(0),
    });
    let funded = Amount::from(ONE_WETH);
    let intent = intent_selling(4);
    assert!(matches!(
        risk.check(&intent, &funded, &funded),
        Decision::Allow
    ));
    risk.record_outflow(&Amount::from(4_u128));
    assert!(matches!(
        risk.check(&intent, &funded, &funded),
        Decision::Reject(RejectReason::PositionCapped { .. })
    ));
}

// ---------- config + redaction ----------

#[test]
fn config_debug_never_leaks_credentials() {
    let config = BotConfig {
        chain_id: SupportedChainId::Sepolia,
        rpc_url: Some("https://sepolia.example/rpc".to_owned()),
        private_key: Some(Redacted::new(
            "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_owned(),
        )),
        the_graph_api_key: Some(Redacted::new("super-secret-graph-key".to_owned())),
        app_code: "cow-trading-bot".to_owned(),
        sell_amount_wei: 5_000_000_000_000_000,
        write_enabled: false,
        log_format: LogFormat::Pretty,
        findings_dir: "findings".into(),
        state_dir: "state".into(),
        telemetry_dir: "telemetry".into(),
    };

    let rendered = format!("{config:?}");
    assert!(
        rendered.contains("[redacted]"),
        "credentials must render redacted"
    );
    assert!(
        !rendered.contains("deadbeef"),
        "the private key must not appear"
    );
    assert!(
        !rendered.contains("super-secret-graph-key"),
        "the api key must not appear"
    );
}
