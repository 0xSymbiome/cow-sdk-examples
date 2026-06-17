//! Wallet wiring + on-chain ERC-20 reads.
//!
//! Built on `cow_sdk::alloy::AlloyClient`, which composes the read-only
//! `Provider` capability with a signer. ERC-20 reads (`balanceOf`, `allowance`)
//! go through the SDK's re-exported `IERC20` bindings via the typed
//! `Provider::call(&TransactionRequest)` seam — no raw JSON-RPC, no hand-rolled
//! ABI. Order signing goes through a signer handle the client mints from its key.

use alloy_sol_types::SolCall;

use cow_sdk::alloy::{
    AlloyClient, AlloyClientBuilderError, AlloyClientError, AlloyClientSignerHandle, RetryConfig,
};
use cow_sdk::contracts::IERC20;
use cow_sdk::core::{
    Address, Amount, HexData, Provider, SigningProvider, TransactionReceipt, TransactionRequest,
};
use cow_sdk::trading::{WaitOptions, submit_and_wait_for_receipt};
use thiserror::Error;

use crate::config::BotConfig;

/// Wallet construction and on-chain-read failures.
#[derive(Debug, Error)]
pub enum WalletError {
    #[error("wallet not configured: COW_BOT_RPC_URL or COW_BOT_PRIVATE_KEY missing")]
    NotConfigured,
    #[error("alloy client build failed: {0}")]
    Build(#[from] AlloyClientBuilderError),
    #[error("alloy client error: {0}")]
    Client(#[from] AlloyClientError),
    #[error("erc20 return decode failed: {0}")]
    Decode(String),
    #[error("transaction wait failed: {0}")]
    Wait(String),
}

/// The bot's chain handle: a configured `AlloyClient` plus its owner address.
pub struct BotWallet {
    client: AlloyClient,
    pub owner: Address,
    signer_hint: String,
}

impl BotWallet {
    /// Builds the wallet from configuration, verifying the RPC actually serves
    /// the configured chain (`build_checked` round-trips `eth_chainId`).
    ///
    /// # Errors
    ///
    /// Returns [`WalletError::NotConfigured`] when the RPC URL or private key is
    /// absent, or a build/client error if the endpoint is unreachable or serves
    /// the wrong chain.
    pub async fn build(config: &BotConfig) -> Result<Self, WalletError> {
        let rpc = config
            .rpc_url
            .as_deref()
            .ok_or(WalletError::NotConfigured)?;
        let key = config
            .private_key
            .as_ref()
            .ok_or(WalletError::NotConfigured)?;

        // Opt into the SDK's transparent RPC retry (bounded exponential backoff
        // for transient public-RPC 429s) so the bot never hand-rolls it.
        let client = AlloyClient::builder()
            .retry(RetryConfig::default())
            .http(rpc)?
            .private_key(key.as_inner().as_str())?
            .chain_id(config.chain_id)
            .build_checked()
            .await?;

        let owner = client.signer_address();
        Ok(Self {
            client,
            owner,
            signer_hint: config.app_code.clone(),
        })
    }

    /// Mints a signer handle bound to this wallet's key, for sign/post/cancel.
    ///
    /// # Errors
    ///
    /// Returns a [`WalletError`] if the signer cannot be created.
    pub async fn signer(&self) -> Result<AlloyClientSignerHandle, WalletError> {
        self.client
            .create_signer(&self.signer_hint)
            .await
            .map_err(WalletError::from)
    }

    /// Submits `tx` with `signer` and waits for its receipt via the SDK's
    /// submit+poll helper. The wallet's client provides the read-only RPC.
    ///
    /// # Errors
    ///
    /// Returns [`WalletError::Wait`] if broadcast or receipt polling fails (and,
    /// for `require_success` options, if the transaction reverts).
    pub async fn submit_and_wait(
        &self,
        signer: &AlloyClientSignerHandle,
        tx: &TransactionRequest,
        options: WaitOptions,
    ) -> Result<TransactionReceipt, WalletError> {
        submit_and_wait_for_receipt(signer, &self.client, tx, options)
            .await
            .map_err(|err| WalletError::Wait(err.to_string()))
    }

    /// `IERC20.balanceOf(owner)` against `token`.
    ///
    /// # Errors
    ///
    /// Returns a [`WalletError`] if the RPC call fails or the return data cannot
    /// be decoded.
    pub async fn balance_of(&self, token: Address) -> Result<Amount, WalletError> {
        let call = IERC20::balanceOfCall {
            account: self.owner.into_alloy(),
        };
        let raw = self
            .client
            .call(&call_tx(token, &call.abi_encode()))
            .await?;
        let balance = IERC20::balanceOfCall::abi_decode_returns(raw.as_slice())
            .map_err(|err| WalletError::Decode(err.to_string()))?;
        // `From<U256>` is the typed seam — no decimal-string round-trip.
        Ok(Amount::from(balance))
    }

    /// `IERC20.allowance(owner, spender)` against `token`.
    ///
    /// # Errors
    ///
    /// Returns a [`WalletError`] if the RPC call fails or the return data cannot
    /// be decoded.
    pub async fn allowance(&self, token: Address, spender: Address) -> Result<Amount, WalletError> {
        let call = IERC20::allowanceCall {
            owner: self.owner.into_alloy(),
            spender: spender.into_alloy(),
        };
        let raw = self
            .client
            .call(&call_tx(token, &call.abi_encode()))
            .await?;
        let allowance = IERC20::allowanceCall::abi_decode_returns(raw.as_slice())
            .map_err(|err| WalletError::Decode(err.to_string()))?;
        Ok(Amount::from(allowance))
    }
}

/// A read-only `TransactionRequest` (no value, no gas) carrying `data` calldata
/// to `to`, for `Provider::call`.
fn call_tx(to: Address, data: &[u8]) -> TransactionRequest {
    TransactionRequest::new(
        Some(to),
        Some(HexData::from_bytes(data.to_vec())),
        None,
        None,
    )
}
