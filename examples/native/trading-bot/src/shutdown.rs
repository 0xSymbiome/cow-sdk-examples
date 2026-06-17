//! Ctrl-C to cooperative cancellation.
//!
//! The returned [`CancellationToken`] is threaded through every long-running SDK
//! call via `Cancellable::cancel_with(&token)`, so an interrupt unwinds cleanly
//! through the crate's `Cancelled` path instead of tearing down mid-request.

use cow_sdk::core::CancellationToken;
use tracing::warn;

/// Installs a Ctrl-C handler that fires the returned token on signal.
#[must_use]
pub fn install() -> CancellationToken {
    let token = CancellationToken::new();
    let token_for_signal = token.clone();
    tokio::spawn(async move {
        match tokio::signal::ctrl_c().await {
            Ok(()) => {
                warn!("Ctrl-C received — firing cooperative cancellation token");
                token_for_signal.cancel();
            }
            Err(err) => {
                warn!(error = %err, "Ctrl-C handler failed to install; cancellation will not fire on signal");
            }
        }
    });
    token
}
