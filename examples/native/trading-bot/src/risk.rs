//! Risk engine — the pre-trade gate the executor consults before every intent
//! reaches the SDK.
//!
//! The strategy emits intents; the risk engine returns a [`Decision`]. Every
//! rejection is a typed [`RejectReason`] so an operator sees exactly why an
//! intent did not make it to the wire. Comparisons run on the typed `Amount`
//! <-> `U256` seam (`as_u256`), never a decimal-string round-trip.

use std::time::{Duration, Instant};

use alloy_primitives::U256;
use cow_sdk::core::Amount;

use crate::strategy::Intent;

/// The gate's verdict for one intent.
#[derive(Debug, Clone)]
pub enum Decision {
    Allow,
    Reject(RejectReason),
}

/// Why an intent was rejected. Each carries the numbers behind the decision.
#[derive(Debug, Clone)]
pub enum RejectReason {
    InsufficientBalance { needed: U256, have: U256 },
    InsufficientAllowance { needed: U256, have: U256 },
    PositionCapped { cap: U256, would_be: U256 },
    RateLimited { wait_secs: u64 },
}

impl RejectReason {
    /// Stable lowercase category for span/finding fields.
    #[must_use]
    pub const fn category(&self) -> &'static str {
        match self {
            Self::InsufficientBalance { .. } => "insufficient-balance",
            Self::InsufficientAllowance { .. } => "insufficient-allowance",
            Self::PositionCapped { .. } => "position-cap",
            Self::RateLimited { .. } => "rate-limited",
        }
    }
}

impl std::fmt::Display for RejectReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InsufficientBalance { needed, have } => {
                write!(
                    f,
                    "insufficient balance: need {needed} wei, have {have} wei"
                )
            }
            Self::InsufficientAllowance { needed, have } => {
                write!(
                    f,
                    "insufficient allowance: need {needed} wei, have {have} wei"
                )
            }
            Self::PositionCapped { cap, would_be } => {
                write!(
                    f,
                    "position cap {cap} wei would be exceeded ({would_be} wei)"
                )
            }
            Self::RateLimited { wait_secs } => write!(f, "rate limited: wait {wait_secs}s"),
        }
    }
}

/// Tunable risk limits.
#[derive(Debug, Clone, Copy)]
pub struct RiskConfig {
    /// Cap on cumulative sell-side outflow over the daemon's lifetime, in wei.
    pub max_position_wei: u128,
    /// Minimum spacing between intents that reach the wire.
    pub min_tick_interval: Duration,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_position_wei: 100_000_000_000_000_000, // 0.1 WETH
            min_tick_interval: Duration::from_secs(5),
        }
    }
}

/// Stateful pre-trade gate.
pub struct RiskEngine {
    config: RiskConfig,
    cumulative_outflow: U256,
    last_pass: Option<Instant>,
}

impl RiskEngine {
    #[must_use]
    pub const fn new(config: RiskConfig) -> Self {
        Self {
            config,
            cumulative_outflow: U256::ZERO,
            last_pass: None,
        }
    }

    /// Records an executed sell so the cumulative-position cap tracks reality.
    pub const fn record_outflow(&mut self, amount: &Amount) {
        self.cumulative_outflow = self.cumulative_outflow.saturating_add(*amount.as_u256());
    }

    /// Pre-trade gate. On `Allow`, advances the rate-limit clock.
    pub fn check(&mut self, intent: &Intent, balance: &Amount, allowance: &Amount) -> Decision {
        if let Some(last) = self.last_pass {
            let elapsed = last.elapsed();
            if elapsed < self.config.min_tick_interval {
                return Decision::Reject(RejectReason::RateLimited {
                    wait_secs: self
                        .config
                        .min_tick_interval
                        .saturating_sub(elapsed)
                        .as_secs()
                        .max(1),
                });
            }
        }

        let needed = *intent.sell_amount.as_u256();
        let have = *balance.as_u256();
        if needed > have {
            return Decision::Reject(RejectReason::InsufficientBalance { needed, have });
        }

        let allowed = *allowance.as_u256();
        if needed > allowed {
            return Decision::Reject(RejectReason::InsufficientAllowance {
                needed,
                have: allowed,
            });
        }

        let would_be = self.cumulative_outflow.saturating_add(needed);
        let cap = U256::from(self.config.max_position_wei);
        if would_be > cap {
            return Decision::Reject(RejectReason::PositionCapped { cap, would_be });
        }

        self.last_pass = Some(Instant::now());
        Decision::Allow
    }
}
