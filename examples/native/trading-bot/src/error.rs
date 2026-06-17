//! Unified command error.
//!
//! SDK leaf errors are carried TYPED (never stringified) wherever they lift
//! cleanly into the SDK's own [`cow_sdk::CowError`] umbrella, so `?` Just Works
//! at call sites and the operator-facing message keeps the SDK's own wording.
//! The bot's own wallet wiring folds in through its typed [`WalletError`].

use thiserror::Error;

use crate::wallet::WalletError;

/// Result alias for command handlers.
pub type CmdResult<T = ()> = Result<T, CommandError>;

/// Error returned by a subcommand handler.
#[derive(Debug, Error)]
pub enum CommandError {
    /// An operator-supplied precondition is missing (RPC, key, write flag).
    #[error("missing required input: {0}")]
    Missing(String),

    /// Wallet wiring / ERC-20 read failure (typed, self-attributed).
    #[error("wallet: {0}")]
    Wallet(#[from] WalletError),

    /// Any high-level SDK error, carried typed through the `CowError` umbrella.
    /// Each core leaf (`OrderbookError`, `TradingError`, ...) lifts into here via
    /// the `From` impls below, so call sites can `?` an SDK error directly.
    #[error("sdk: {0}")]
    Cow(#[from] cow_sdk::CowError),

    /// Local I/O failure (findings/state files).
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// A cooperative cancellation token fired (Ctrl-C). Distinct so the process
    /// can exit `130` rather than as a generic failure.
    #[error("cancelled")]
    Cancelled,
}

impl CommandError {
    /// Process exit code for this error, following the BSD `sysexits` convention
    /// the bot documents in its README.
    #[must_use]
    pub const fn exit_code(&self) -> u8 {
        match self {
            Self::Cancelled => 130,
            Self::Missing(_) => 78, // EX_CONFIG
            Self::Wallet(_) | Self::Cow(_) | Self::Io(_) => 1,
        }
    }
}

/// Lifts each SDK core leaf error directly into [`CommandError::Cow`] so a call
/// site can `?` it without naming `CowError`; the umbrella aggregates the leaves
/// via `#[from]`, and this one extra hop lets `?` skip it.
macro_rules! leaf_into_cow {
    ($($leaf:ty),+ $(,)?) => { $(
        impl From<$leaf> for CommandError {
            fn from(error: $leaf) -> Self {
                Self::Cow(cow_sdk::CowError::from(error))
            }
        }
    )+ };
}
leaf_into_cow!(
    cow_sdk::core::CoreError,
    cow_sdk::trading::TradingError,
    cow_sdk::orderbook::OrderbookError,
    cow_sdk::subgraph::SubgraphError,
);
