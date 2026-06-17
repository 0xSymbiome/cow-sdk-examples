//! `cow-trading-bot` — a live reference CoW Protocol trading bot built on the
//! **published** `cow-sdk` crate (crates.io / <https://docs.rs/cow-sdk>).
//!
//! The bot is shaped like a real consumer application rather than a test
//! harness: environment-driven configuration, a structured `tracing` subscriber
//! (the SDK's own spans nest under the bot's), cooperative cancellation from
//! Ctrl-C, typed error handling, and operator-facing subcommands.
//!
//! This library crate holds the bot's logic so it can be unit- and
//! integration-tested; the thin binary in `main.rs` wires it to the process.
//! See `README.md` for the operator guide and `.env.example` for setup.

// `CommandError` carries the SDK's typed leaf errors rather than stringifying
// them; those types are larger than a `String`, which trips `result_large_err`.
// On a CLI bot the richer, matchable error is worth a few bytes on the cold path.
#![allow(
    clippy::result_large_err,
    reason = "command errors carry the SDK's typed leaf errors for precise handling"
)]

pub mod cli;
pub mod commands;
pub mod config;
pub mod error;
pub mod findings;
pub mod observability;
pub mod portfolio;
pub mod risk;
pub mod shutdown;
pub mod state;
pub mod strategy;
pub mod treasury;
pub mod wallet;
