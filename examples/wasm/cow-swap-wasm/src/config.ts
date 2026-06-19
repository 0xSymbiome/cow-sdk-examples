// Public application identifier attached to every order for solver attribution.
// App codes are public order metadata, never a secret.
export const APP_CODE = 'cow-swap-wasm'

// Default slippage applied to market swaps unless the user overrides it.
export const DEFAULT_SLIPPAGE_BPS = 50

// Default order lifetime (minutes) before an unfilled order expires.
export const DEFAULT_EXPIRY_MINUTES = 30

// How often orders are re-polled while one is still settling.
export const ORDER_POLL_PENDING_MS = 4_000

// Idle re-poll cadence once nothing is settling.
export const ORDER_POLL_IDLE_MS = 30_000

// How long a freshly fetched quote is treated as valid in the UI before it is
// re-requested. The orderbook also returns an absolute expiry we display.
export const QUOTE_REFRESH_INTERVAL_MS = 20_000

// CoW Explorer base; order pages live at `{base}/{network}/orders/{uid}`.
export const COW_EXPLORER_BASE = 'https://explorer.cow.fi'
