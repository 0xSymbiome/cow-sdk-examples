//! Hand-rolled CLI parser.
//!
//! A small, explicit command schema keeps the dependency surface narrow (no
//! argument-parser crate) and the command set easy to read at a glance.

pub const HELP_TEXT: &str =
    "cow-trading-bot — live reference trading bot for the CoW Protocol Rust SDK.

USAGE:
    cow-trading-bot <COMMAND> [OPTIONS]

COMMANDS:
    inspect       Print wallet, balances, allowance, orderbook + subgraph health
                  (read-only, no gas).
    run           Run the trading cycle: quote -> sign -> post -> poll ->
                  off-chain cancel. Requires COW_BOT_WRITE=yes.
    daemon        Run the autonomous strategy loop: treasury preflight -> plan ->
                  risk gate -> execute -> portfolio. Requires COW_BOT_WRITE=yes.
    cancel-all    Off-chain cancel every open order belonging to the bot wallet.
    topup         Wrap ETH -> WETH and approve the vault relayer (idempotent).
                  Requires COW_BOT_WRITE=yes.
    approve       Set or revoke the vault-relayer WETH allowance.
                  Requires COW_BOT_WRITE=yes.
    history       Print recent trades and lifetime surplus (read-only).
    portfolio     Print persisted bot bookkeeping (offline).
    liveness      Health probe for orchestrators (exit 0 healthy / 1 degraded).
    console       Serve a loopback telemetry dashboard that live-tails telemetry/.

GLOBAL OPTIONS:
    -h, --help       Print help and exit.
    -V, --version    Print version and exit.

RUN OPTIONS:
    --cycles=<N>        Submit/cancel cycles to perform (default: 1, 0 = forever).
    --strategy=<NAME>   One of: market-take, limit-make (default: market-take).
    --no-cancel         Post the order(s) but do NOT off-chain cancel afterwards.

DAEMON OPTIONS:
    --strategy=<NAME>   One of: taker, twap, dca (default: taker).
    --cycles=<N>        Ticks to run (default: 3, 0 = forever).

APPROVE OPTIONS:
    --amount=<wei>      Allowance to set in wei (default: 1 WETH; 0 revokes).

CONSOLE OPTIONS:
    --port=<N>          Loopback dashboard port (default: 8787).

Configuration is read from the environment; copy .env.example to .env. Any
wallet-touching command needs COW_BOT_RPC_URL and COW_BOT_PRIVATE_KEY.";

/// Outcome of parsing the command line that is not a runnable command.
#[derive(Debug)]
pub enum ParseError {
    Help,
    Version,
    Bad(String),
}

/// A parsed, runnable command.
#[derive(Debug)]
pub enum Command {
    Inspect,
    Run(RunArgs),
    Daemon(DaemonArgs),
    CancelAll,
    Topup,
    Approve(ApproveArgs),
    History,
    Portfolio,
    Liveness,
    Console(ConsoleArgs),
}

impl Command {
    /// Stable lowercase name, used as a span/log field.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Inspect => "inspect",
            Self::Run(_) => "run",
            Self::Daemon(_) => "daemon",
            Self::CancelAll => "cancel-all",
            Self::Topup => "topup",
            Self::Approve(_) => "approve",
            Self::History => "history",
            Self::Portfolio => "portfolio",
            Self::Liveness => "liveness",
            Self::Console(_) => "console",
        }
    }
}

/// Options for the `run` command.
#[derive(Debug)]
pub struct RunArgs {
    /// Number of cycles; `0` means run until interrupted.
    pub cycles: u32,
    pub strategy: Strategy,
    /// Whether to off-chain cancel each posted order after polling.
    pub cancel_after: bool,
}

impl Default for RunArgs {
    fn default() -> Self {
        Self {
            cycles: 1,
            strategy: Strategy::MarketTake,
            cancel_after: true,
        }
    }
}

/// How an order is priced and posted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Strategy {
    /// Market sell at the quoted price plus slippage tolerance.
    #[default]
    MarketTake,
    /// Limit ask 1% above the quoted price (rests instead of filling immediately).
    LimitMake,
}

impl Strategy {
    /// Stable lowercase label for span/log fields.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::MarketTake => "market-take",
            Self::LimitMake => "limit-make",
        }
    }
}

/// Options for the `daemon` command.
#[derive(Debug)]
pub struct DaemonArgs {
    /// Strategy name: `taker`, `twap`, or `dca`.
    pub strategy: String,
    /// Number of ticks; `0` means run until interrupted.
    pub cycles: u32,
}

impl Default for DaemonArgs {
    fn default() -> Self {
        Self {
            strategy: "taker".to_owned(),
            cycles: 3,
        }
    }
}

/// Options for the `approve` command.
#[derive(Debug)]
pub struct ApproveArgs {
    /// Allowance to set, in wei (`0` revokes).
    pub amount_wei: u128,
}

impl Default for ApproveArgs {
    fn default() -> Self {
        Self {
            amount_wei: 1_000_000_000_000_000_000, // 1 WETH
        }
    }
}

/// Options for the `console` command.
#[derive(Debug)]
pub struct ConsoleArgs {
    /// Loopback port for the dashboard.
    pub port: u16,
}

impl Default for ConsoleArgs {
    fn default() -> Self {
        Self { port: 8787 }
    }
}

/// Parses process arguments into a [`Command`].
///
/// # Errors
///
/// Returns [`ParseError::Help`] / [`ParseError::Version`] for the respective
/// flags, or [`ParseError::Bad`] for a missing/unknown subcommand or option.
pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Command, ParseError> {
    let mut args = args.into_iter();
    let _argv0 = args.next();
    let Some(subcommand) = args.next() else {
        return Err(ParseError::Bad("missing subcommand".to_owned()));
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Err(ParseError::Help);
    }
    if matches!(subcommand.as_str(), "-V" | "--version" | "version") {
        return Err(ParseError::Version);
    }
    let rest: Vec<String> = args.collect();
    match subcommand.as_str() {
        "inspect" => Ok(Command::Inspect),
        "run" => Ok(Command::Run(parse_run(&rest)?)),
        "daemon" => Ok(Command::Daemon(parse_daemon(&rest)?)),
        "cancel-all" => Ok(Command::CancelAll),
        "topup" => Ok(Command::Topup),
        "approve" => Ok(Command::Approve(parse_approve(&rest)?)),
        "history" => Ok(Command::History),
        "portfolio" => Ok(Command::Portfolio),
        "liveness" => Ok(Command::Liveness),
        "console" => Ok(Command::Console(parse_console(&rest)?)),
        other => Err(ParseError::Bad(format!("unknown subcommand `{other}`"))),
    }
}

fn parse_console(args: &[String]) -> Result<ConsoleArgs, ParseError> {
    let mut out = ConsoleArgs::default();
    for arg in args {
        if let Some(value) = arg.strip_prefix("--port=") {
            out.port = value.parse().map_err(|_| {
                ParseError::Bad(format!("--port expects a port number, got `{value}`"))
            })?;
        } else if arg == "-h" || arg == "--help" {
            return Err(ParseError::Help);
        } else {
            return Err(ParseError::Bad(format!(
                "unknown `console` argument: {arg}"
            )));
        }
    }
    Ok(out)
}

fn parse_approve(args: &[String]) -> Result<ApproveArgs, ParseError> {
    let mut out = ApproveArgs::default();
    for arg in args {
        if let Some(value) = arg.strip_prefix("--amount=") {
            out.amount_wei = value.parse().map_err(|_| {
                ParseError::Bad(format!("--amount expects a wei integer, got `{value}`"))
            })?;
        } else if arg == "-h" || arg == "--help" {
            return Err(ParseError::Help);
        } else {
            return Err(ParseError::Bad(format!(
                "unknown `approve` argument: {arg}"
            )));
        }
    }
    Ok(out)
}

fn parse_daemon(args: &[String]) -> Result<DaemonArgs, ParseError> {
    let mut out = DaemonArgs::default();
    for arg in args {
        if let Some(value) = arg.strip_prefix("--strategy=") {
            value.clone_into(&mut out.strategy);
        } else if let Some(value) = arg.strip_prefix("--cycles=") {
            out.cycles = value.parse().map_err(|_| {
                ParseError::Bad(format!("--cycles expects an integer, got `{value}`"))
            })?;
        } else if arg == "-h" || arg == "--help" {
            return Err(ParseError::Help);
        } else {
            return Err(ParseError::Bad(format!("unknown `daemon` argument: {arg}")));
        }
    }
    Ok(out)
}

fn parse_run(args: &[String]) -> Result<RunArgs, ParseError> {
    let mut out = RunArgs::default();
    for arg in args {
        if let Some(value) = arg.strip_prefix("--cycles=") {
            out.cycles = value.parse().map_err(|_| {
                ParseError::Bad(format!("--cycles expects an integer, got `{value}`"))
            })?;
        } else if let Some(value) = arg.strip_prefix("--strategy=") {
            out.strategy = parse_strategy(value)?;
        } else if arg == "--no-cancel" {
            out.cancel_after = false;
        } else if arg == "-h" || arg == "--help" {
            return Err(ParseError::Help);
        } else {
            return Err(ParseError::Bad(format!("unknown `run` argument: {arg}")));
        }
    }
    Ok(out)
}

fn parse_strategy(value: &str) -> Result<Strategy, ParseError> {
    match value {
        "market-take" => Ok(Strategy::MarketTake),
        "limit-make" => Ok(Strategy::LimitMake),
        other => Err(ParseError::Bad(format!("unknown strategy `{other}`"))),
    }
}
