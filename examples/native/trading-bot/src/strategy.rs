//! Strategy framework — the `daemon` ticks these.
//!
//! A strategy is a deterministic plan generator: given a [`WorldView`] (current
//! balances and allowance), it emits zero or more [`Intent`]s. The risk engine
//! gates each intent before the executor sends it to the SDK. The strategies are
//! intentionally small — they show where a real bot slots its decision logic in
//! front of the SDK, not how to find alpha.
//!
//! Each strategy stores its sizing as `u128` wei and mints a fresh
//! [`Amount`] per tick through the infallible `Amount::from` constructor.

use cow_sdk::core::{Address, Amount, OrderKind};

use crate::config;

/// A single trade a strategy wants to attempt this tick.
#[derive(Debug, Clone)]
pub struct Intent {
    pub kind: OrderKind,
    pub sell_token: Address,
    pub buy_token: Address,
    pub sell_amount: Amount,
    pub slippage_bps: u32,
    pub label: String,
}

/// What a strategy sees each tick.
#[derive(Debug, Clone)]
pub struct WorldView {
    pub tick: u32,
    pub weth_balance: Amount,
    pub cow_balance: Amount,
    pub allowance: Amount,
}

/// A deterministic plan generator the daemon ticks.
pub trait Strategy: Send {
    /// Stable lowercase name for span/log fields.
    fn name(&self) -> &'static str;
    /// Emits the intents to attempt for this tick.
    fn on_tick(&mut self, world: &WorldView) -> Vec<Intent>;
}

/// Builds a strategy by name, or `None` if the name is unknown.
#[must_use]
pub fn build(name: &str, sell_amount_wei: u128) -> Option<Box<dyn Strategy>> {
    match name {
        "taker" => Some(Box::new(Taker { sell_amount_wei })),
        "twap" => Some(Box::new(Twap::new(sell_amount_wei, 4))),
        "dca" => Some(Box::new(Dca { sell_amount_wei })),
        _ => None,
    }
}

fn sell_weth(sell_amount_wei: u128, slippage_bps: u32, label: String) -> Intent {
    Intent {
        kind: OrderKind::Sell,
        sell_token: config::WETH,
        buy_token: config::COW,
        sell_amount: Amount::from(sell_amount_wei),
        slippage_bps,
        label,
    }
}

/// Sells a fixed size of WETH at market each tick.
struct Taker {
    sell_amount_wei: u128,
}

impl Strategy for Taker {
    fn name(&self) -> &'static str {
        "taker"
    }
    fn on_tick(&mut self, _world: &WorldView) -> Vec<Intent> {
        vec![sell_weth(
            self.sell_amount_wei,
            50,
            "taker: market sell WETH -> COW".to_owned(),
        )]
    }
}

/// Splits a budget into `slices` equal market sells, one per tick, then stops.
struct Twap {
    slice_wei: u128,
    slices: u32,
    emitted: u32,
}

impl Twap {
    fn new(total_wei: u128, slices: u32) -> Self {
        let slices = slices.max(1);
        Self {
            slice_wei: total_wei / u128::from(slices),
            slices,
            emitted: 0,
        }
    }
}

impl Strategy for Twap {
    fn name(&self) -> &'static str {
        "twap"
    }
    fn on_tick(&mut self, _world: &WorldView) -> Vec<Intent> {
        if self.emitted >= self.slices {
            return Vec::new();
        }
        self.emitted += 1;
        vec![sell_weth(
            self.slice_wei,
            50,
            format!("twap: slice {}/{}", self.emitted, self.slices),
        )]
    }
}

/// Sells a fixed size every tick, forever (dollar-cost-averaging shape).
struct Dca {
    sell_amount_wei: u128,
}

impl Strategy for Dca {
    fn name(&self) -> &'static str {
        "dca"
    }
    fn on_tick(&mut self, _world: &WorldView) -> Vec<Intent> {
        vec![sell_weth(
            self.sell_amount_wei,
            50,
            "dca: fixed budget every tick".to_owned(),
        )]
    }
}
