//! Binary entry point for `cow-trading-bot`.
//!
//! The testable logic lives in the library crate (`lib.rs`); this binary wires
//! it to the process: `.env` loading, CLI parsing, observability install, the
//! Ctrl-C cancellation handler, and command dispatch with `sysexits` exit codes.

use std::process::ExitCode;

use tracing::info;

use cow_trading_bot::cli::{self, Command};
use cow_trading_bot::{commands, config, observability, shutdown};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    // Load a local `.env` if present. `from_path` (not the `_override` variant)
    // lets explicit shell env vars win, so an operator can override one value
    // ad hoc without editing the file.
    if std::path::Path::new(".env").exists() {
        let _ = dotenvy::from_path(".env");
    }

    let command = match cli::parse(std::env::args()) {
        Ok(command) => command,
        Err(cli::ParseError::Help) => {
            println!("{}", cli::HELP_TEXT);
            return ExitCode::SUCCESS;
        }
        Err(cli::ParseError::Version) => {
            println!("cow-trading-bot {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Err(cli::ParseError::Bad(message)) => {
            eprintln!("argument error: {message}\n");
            eprintln!("{}", cli::HELP_TEXT);
            return ExitCode::from(64); // EX_USAGE
        }
    };

    let config = match config::BotConfig::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("config error: {err}");
            return ExitCode::from(78); // EX_CONFIG
        }
    };

    observability::install(&config, command.name());

    info!(
        version = env!("CARGO_PKG_VERSION"),
        command = command.name(),
        chain = config.chain_id_u64(),
        wallet_configured = config.wallet_configured(),
        write_enabled = config.write_enabled,
        "cow-trading-bot starting (built on the published cow-sdk crate)"
    );

    // Ctrl-C fires this token; long-running commands thread it through every SDK
    // call via `Cancellable::cancel_with`. `inspect` is fast and does not use it,
    // but the handler is installed uniformly.
    let cancel = shutdown::install();

    let result = match command {
        Command::Inspect => commands::inspect::run(&config).await,
        Command::Run(args) => commands::run::run(args, &config, cancel.clone()).await,
        Command::Daemon(args) => commands::daemon::run(args, &config, cancel.clone()).await,
        Command::CancelAll => commands::cancel_all::run(&config, cancel.clone()).await,
        Command::Topup => commands::topup::run(&config).await,
        Command::Approve(args) => commands::approve::run(args, &config).await,
        Command::History => commands::history::run(&config, cancel.clone()).await,
        Command::Portfolio => commands::portfolio::run(&config),
        Command::Liveness => commands::liveness::run(&config).await,
        Command::Console(args) => commands::console::run(args, &config, cancel.clone()).await,
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            tracing::error!(error = %err, "command failed");
            ExitCode::from(err.exit_code())
        }
    }
}
