//! Bot configuration.
//!
//! Driven entirely by the environment and constructed once at startup, then
//! passed by reference (no process-global mutable state). Every credential is
//! wrapped in [`Redacted`] so a stray `Debug` render can never leak the private
//! key or API key.

use std::path::PathBuf;
use std::str::FromStr;

use cow_sdk::core::{Address, Redacted, SupportedChainId, address};
use thiserror::Error;

// Sepolia token set. `address!` validates the literal at compile time (lowercase
// wire form), so these are infallible constants — no runtime parse, no `unwrap`.
/// Sepolia WETH — the sell token in the bot's demo pair.
pub const WETH: Address = address!("0xfff9976782d46cc05630d1f6ebab18b2324d6b14");
/// Sepolia COW — the buy token in the bot's demo pair.
pub const COW: Address = address!("0x0625afb445c3b6b7b929342a04a22599fd5dbb59");
/// Sepolia CoW vault relayer — the spender an order authorizes to pull the sell
/// token at settlement.
pub const VAULT_RELAYER: Address = address!("0xc92e8bdf79f0507f65a392b0ab4667716bfe0110");

const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
/// Default sell size: 0.005 WETH, which clears the Sepolia liquidity floor.
const DEFAULT_SELL_AMOUNT_WEI: u128 = 5_000_000_000_000_000;

/// Configuration errors surfaced before the bot does any work.
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("COW_BOT_SELL_AMOUNT_WEI is not a valid wei amount: {0}")]
    InvalidSellAmount(String),
    #[error("unsupported COW_BOT_CHAIN_ID `{0}` — only Sepolia (11155111) is supported")]
    UnsupportedChain(String),
}

/// Console log rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable (default).
    Pretty,
    /// One JSON line per event, for log shippers.
    Json,
}

/// Bot-wide configuration. Construct once with [`BotConfig::from_env`], then pass
/// by reference.
#[derive(Debug)]
pub struct BotConfig {
    pub chain_id: SupportedChainId,
    pub rpc_url: Option<String>,
    pub private_key: Option<Redacted<String>>,
    pub the_graph_api_key: Option<Redacted<String>>,
    pub app_code: String,
    pub sell_amount_wei: u128,
    pub write_enabled: bool,
    pub log_format: LogFormat,
    pub findings_dir: PathBuf,
    pub state_dir: PathBuf,
    pub telemetry_dir: PathBuf,
}

impl BotConfig {
    /// Loads the configuration from the environment.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when `COW_BOT_CHAIN_ID` names a network other than
    /// Sepolia or `COW_BOT_SELL_AMOUNT_WEI` is not a valid wei amount.
    pub fn from_env() -> Result<Self, ConfigError> {
        if let Some(id) = env_opt("COW_BOT_CHAIN_ID")
            && id != SEPOLIA_CHAIN_ID.to_string()
        {
            return Err(ConfigError::UnsupportedChain(id));
        }

        let private_key = env_opt("COW_BOT_PRIVATE_KEY").map(|key| {
            let normalised = if key.starts_with("0x") {
                key
            } else {
                format!("0x{key}")
            };
            Redacted::new(normalised)
        });

        let sell_amount_wei = match env_opt("COW_BOT_SELL_AMOUNT_WEI") {
            Some(s) => u128::from_str(&s).map_err(|_| ConfigError::InvalidSellAmount(s))?,
            None => DEFAULT_SELL_AMOUNT_WEI,
        };

        let log_format = match env_opt("COW_BOT_LOG_FORMAT").as_deref() {
            Some("json") => LogFormat::Json,
            _ => LogFormat::Pretty,
        };

        Ok(Self {
            chain_id: SupportedChainId::Sepolia,
            rpc_url: env_opt("COW_BOT_RPC_URL"),
            private_key,
            the_graph_api_key: env_opt("THE_GRAPH_API_KEY").map(Redacted::new),
            app_code: env_opt("COW_BOT_APP_CODE").unwrap_or_else(|| "cow-trading-bot".to_owned()),
            sell_amount_wei,
            write_enabled: env_opt("COW_BOT_WRITE").is_some_and(|v| v.eq_ignore_ascii_case("yes")),
            log_format,
            findings_dir: PathBuf::from("findings"),
            state_dir: PathBuf::from("state"),
            telemetry_dir: PathBuf::from("telemetry"),
        })
    }

    /// True when both an RPC endpoint and a signing key are configured.
    #[must_use]
    pub const fn wallet_configured(&self) -> bool {
        self.rpc_url.is_some() && self.private_key.is_some()
    }

    /// The numeric chain id, for span fields and operator logs.
    #[must_use]
    pub fn chain_id_u64(&self) -> u64 {
        self.chain_id.into()
    }
}

/// Reads an environment variable, treating blank or whitespace-only values as
/// unset and trimming the result.
fn env_opt(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
