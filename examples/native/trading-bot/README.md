# cow-trading-bot

A live, real-shape reference trading bot for the [CoW Protocol Rust SDK](https://docs.rs/cow-sdk),
built on the **published** `cow-sdk` crate from crates.io. It is shaped like a
production consumer application — environment-driven configuration, structured
`tracing` telemetry, cooperative cancellation, typed error handling, and
operator-facing subcommands — rather than a one-shot snippet.

Because it depends on the published crate (no path, no patch), a clean build of
this bot is itself a standing proof that `cow-sdk` works end-to-end for an
outside consumer.

> **Testnet bot.** It targets Sepolia and uses a throwaway test wallet. Never
> point it at a wallet holding real funds.

## Quick start

```bash
# From this directory:
cp .env.example .env          # then fill in COW_BOT_RPC_URL + COW_BOT_PRIVATE_KEY
cargo run -- inspect          # read-only health probe — no gas, no orders
```

`inspect` reads your wallet balances and allowance, checks orderbook and
subgraph reachability, and lists your open orders. It is the first command to
run to confirm the bot is wired correctly.

## Commands

| Command | What it does |
| --- | --- |
| `inspect` | Wallet, WETH/COW balances, vault-relayer allowance, orderbook + subgraph health, open orders. Read-only. |
| `run` | One trading cycle: quote → sign → post → poll → off-chain cancel. `--strategy=market-take\|limit-make`, `--cycles=N`, `--no-cancel`. |
| `daemon` | Autonomous loop: treasury preflight → strategy → risk gate → execute → portfolio. `--strategy=taker\|twap\|dca`, `--cycles=N`. |
| `cancel-all` | Off-chain cancel every open order owned by the wallet. |
| `topup` | Wrap ETH → WETH up to the floor and approve the vault relayer (idempotent). |
| `approve` | Set or revoke the vault-relayer WETH allowance. `--amount=<wei>`. |
| `history` | Recent trades and lifetime surplus for the wallet. Read-only. |
| `portfolio` | Print persisted bot bookkeeping (offline). |
| `liveness` | Orchestrator health probe (exit `0` healthy / non-zero degraded). |
| `console` | Serve a loopback telemetry dashboard that live-tails `telemetry/`. `--port=<N>`. |

Write commands (`run`, `daemon`, `topup`, `approve`) require `COW_BOT_WRITE=yes`.
Run `cow-trading-bot --help` for the full flag set.

## Configuration

All configuration is read from the environment; copy `.env.example` to `.env`
(which is gitignored). Credentials are wrapped so they never appear in logs.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `COW_BOT_RPC_URL` | yes (wallet commands) | — | Sepolia RPC endpoint. |
| `COW_BOT_PRIVATE_KEY` | yes (wallet commands) | — | Test-wallet key (32-byte hex). |
| `COW_BOT_WRITE` | for write commands | `no` | Must be `yes` to allow on-chain writes / order posts. |
| `COW_BOT_CHAIN_ID` | no | `11155111` | Sepolia; the only supported chain. |
| `COW_BOT_APP_CODE` | no | `cow-trading-bot` | Identity stamped into order app-data. |
| `COW_BOT_SELL_AMOUNT_WEI` | no | `5000000000000000` | Default sell size (0.005 WETH). |
| `COW_BOT_LOG_FORMAT` | no | `pretty` | `pretty` or `json`. |
| `THE_GRAPH_API_KEY` | no | — | Enables subgraph analytics. |

## Telemetry

The bot installs a `tracing-subscriber` and enables the SDK's `tracing` feature,
so **the SDK's own spans nest under the bot's spans with no extra wiring**. Every
orderbook / subgraph / transport call shows up in the trace with its endpoint,
method, and status; credentials and response bodies are never recorded.

```bash
RUST_LOG=info,cow_sdk=debug cargo run -- inspect      # tune verbosity
COW_BOT_LOG_FORMAT=json cargo run -- inspect          # one JSON line per event
```

Every run also mirrors its events to `telemetry/<command>-<UTC>.ndjson`, and the
`console` command serves a loopback dashboard that live-tails them:

```bash
cargo run -- console            # then open http://127.0.0.1:8787/
# run any other command in a second terminal — the dashboard streams its events
```

Each run also appends a JSONL summary to `findings/<UTC>.jsonl` for offline
inspection.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Generic failure |
| `64` | Argument error |
| `78` | Configuration error |
| `130` | Interrupted (Ctrl-C — cooperative cancellation fired) |

## How it is built

The bot models SDK usage: the `cow-sdk` facade as the single
dependency, compile-time-validated `address!` token constants, typed `Amount`
construction (`Amount::from` / `parse_units`, never decimal-string round-trips),
typed error handling via the SDK's `CowError` / `ErrorClass` surface, and
`Cancellable::cancel_with` on every long-running call so Ctrl-C unwinds cleanly.
