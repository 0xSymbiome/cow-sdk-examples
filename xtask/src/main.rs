//! Repository task runner for `cow-sdk-examples`.
//!
//! Maintained guarantees are exposed as subcommands invoked through the `cargo`
//! aliases declared in `.cargo/config.toml`, so the same command runs
//! identically on every contributor platform and in CI.

use std::path::Path;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("run-deterministic-examples") => run_deterministic_examples(),
        Some(other) => {
            eprintln!("xtask: unknown command `{other}`");
            usage();
            ExitCode::FAILURE
        }
        None => {
            usage();
            ExitCode::FAILURE
        }
    }
}

fn usage() {
    eprintln!("usage: cargo xtask <command>");
    eprintln!("commands:");
    eprintln!(
        "  run-deterministic-examples   run every non-live example scenario, failing on any error"
    );
}

// Runs the deterministic (non-live) example tests. The native trading-bot's
// suite is deterministic and offline; its live tests are `#[ignore]` and stay
// out of this lane. If no example crate is present the runner is a green no-op,
// keeping the CI lane stable on the repository foundation.
fn run_deterministic_examples() -> ExitCode {
    const MANIFEST: &str = "examples/native/trading-bot/Cargo.toml";
    if !Path::new(MANIFEST).exists() {
        println!("xtask: no example crates registered yet; nothing to run");
        return ExitCode::SUCCESS;
    }

    println!("xtask: running cow-trading-bot deterministic tests");
    match Command::new(env!("CARGO"))
        .args(["test", "--manifest-path", MANIFEST, "--locked"])
        .status()
    {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => {
            eprintln!("xtask: cow-trading-bot tests failed ({status})");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("xtask: failed to launch cargo test: {error}");
            ExitCode::FAILURE
        }
    }
}
