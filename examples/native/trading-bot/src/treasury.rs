//! Treasury — keeps the wallet ready to trade.
//!
//! Before each daemon tick the treasury checks two funding invariants and
//! repairs them idempotently:
//!  * the vault-relayer WETH allowance is at least the configured target
//!    (`approval_transaction` + wait), and
//!  * the WETH balance is at least the floor (wrap ETH via `wrap_transaction`).
//!
//! When an invariant already holds the check is a read-only no-op, so the
//! treasury is safe to run every tick. Repairs send real transactions and
//! therefore require `COW_BOT_WRITE=yes`; without it the treasury logs the
//! shortfall and leaves repair to the operator (`topup` / `approve`).

use alloy_primitives::U256;
use cow_sdk::alloy::AlloyClientSignerHandle;
use cow_sdk::core::Amount;
use cow_sdk::orderbook::CowEnv;
use cow_sdk::trading::{ApprovalParams, WaitOptions, approval_transaction, wrap_transaction};
use tracing::{info, warn};

use crate::config::{self, BotConfig};
use crate::error::CommandError;
use crate::wallet::BotWallet;

/// Default WETH balance floor (0.01 WETH).
const DEFAULT_WETH_FLOOR_WEI: u128 = 10_000_000_000_000_000;
/// Default relayer allowance target (1 WETH).
const DEFAULT_ALLOWANCE_TARGET_WEI: u128 = 1_000_000_000_000_000_000;

/// Funding floors the treasury maintains.
pub struct Treasury {
    /// Minimum WETH balance to keep available (wei).
    weth_floor_wei: u128,
    /// Allowance to approve up to when the relayer allowance is below the floor (wei).
    allowance_target_wei: u128,
}

impl Treasury {
    #[must_use]
    pub const fn new(weth_floor_wei: u128, allowance_target_wei: u128) -> Self {
        Self {
            weth_floor_wei,
            allowance_target_wei,
        }
    }

    /// A treasury with the bot's default floors: a 0.01 WETH balance floor and a
    /// 1 WETH relayer allowance target.
    #[must_use]
    pub const fn with_defaults() -> Self {
        Self::new(DEFAULT_WETH_FLOOR_WEI, DEFAULT_ALLOWANCE_TARGET_WEI)
    }

    /// Ensures the relayer allowance and WETH balance are above their floors,
    /// repairing each idempotently.
    ///
    /// # Errors
    ///
    /// Returns a [`CommandError`] if a chain read fails or a repair transaction
    /// cannot be built or mined.
    pub async fn ensure_ready(
        &self,
        wallet: &BotWallet,
        signer: &AlloyClientSignerHandle,
        config: &BotConfig,
    ) -> Result<(), CommandError> {
        self.ensure_allowance(wallet, signer, config).await?;
        self.ensure_weth_floor(wallet, signer, config).await?;
        Ok(())
    }

    async fn ensure_allowance(
        &self,
        wallet: &BotWallet,
        signer: &AlloyClientSignerHandle,
        config: &BotConfig,
    ) -> Result<(), CommandError> {
        let allowance = wallet
            .allowance(config::WETH, config::VAULT_RELAYER)
            .await?;
        if *allowance.as_u256() >= U256::from(self.allowance_target_wei) {
            info!(allowance_wei = %allowance, "treasury: relayer allowance sufficient");
            return Ok(());
        }
        if !config.write_enabled {
            warn!(allowance_wei = %allowance, "treasury: allowance below target, COW_BOT_WRITE!=yes — skipping approve");
            return Ok(());
        }
        info!("treasury: approving relayer allowance");
        let params = ApprovalParams::new(config::WETH, Amount::from(self.allowance_target_wei));
        let tx = approval_transaction(&params, config.chain_id, CowEnv::Prod)?;
        wallet
            .submit_and_wait(signer, &tx, WaitOptions::approve_default())
            .await?;
        info!("treasury: relayer allowance approved");
        Ok(())
    }

    async fn ensure_weth_floor(
        &self,
        wallet: &BotWallet,
        signer: &AlloyClientSignerHandle,
        config: &BotConfig,
    ) -> Result<(), CommandError> {
        let balance = wallet.balance_of(config::WETH).await?;
        let floor = U256::from(self.weth_floor_wei);
        if *balance.as_u256() >= floor {
            info!(weth_wei = %balance, "treasury: WETH balance sufficient");
            return Ok(());
        }
        if !config.write_enabled {
            warn!(weth_wei = %balance, "treasury: WETH below floor, COW_BOT_WRITE!=yes — skipping wrap");
            return Ok(());
        }
        // Wrap exactly the deficit so the balance reaches the floor. The SDK
        // resolves the chain's wrapped-native token and builds the deposit
        // transaction; no manual interaction assembly.
        let deficit = floor - *balance.as_u256();
        info!(deficit_wei = %deficit, "treasury: wrapping ETH -> WETH to reach floor");
        let tx = wrap_transaction(config.chain_id, Amount::from_u256(deficit));
        wallet
            .submit_and_wait(signer, &tx, WaitOptions::inclusion_default())
            .await?;
        info!("treasury: wrapped ETH -> WETH");
        Ok(())
    }
}
