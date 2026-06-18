# Examples

The CoW SDK cookbook — runnable paths grouped by goal and runtime. Every example
depends on the published SDK and carries its own README with build and run steps.
Examples are published incrementally; this catalog is the source of truth for what
is available.

## Start here

The fastest way to see the whole order lifecycle is the flagship browser dApp,
**[`cow-swap-wasm`](wasm/cow-swap-wasm)** — quote, sign, post, track, surplus, and
cancel, entirely client-side.

| If you want to… | Look at |
| --- | --- |
| See a complete swap UI built on the SDK | [`cow-swap-wasm`](wasm/cow-swap-wasm) (browser) |
| Sign orders in a backend without a wallet extension | [`cow-signer-node`](wasm/cow-signer-node) (Node) |
| Run SDK logic at the edge | [`cow-gateway-cloudflare`](wasm/cow-gateway-cloudflare) (Cloudflare Worker) |
| Drive the lifecycle from native Rust | [`trading-bot`](native/trading-bot) |

## WASM / TypeScript

Standalone projects under [`wasm/`](wasm), each depending on the published
`@symbiome-forge/cow-sdk-wasm` package and one flavor subpath. Each carries its own
README; run with `pnpm install && pnpm test` (a `tsc` typecheck plus the Vitest
suite).

| Project | Runtime | Surface | Demonstrates |
| --- | --- | --- | --- |
| [`cow-swap-wasm`](wasm/cow-swap-wasm) | Browser (Vite + React) | npm `/trading` | A complete client-side swap dApp — full lifecycle, surplus and solver competition, cancellation, and every supported chain, with no backend |
| [`cow-signer-node`](wasm/cow-signer-node) | Node.js ≥ 22 | npm `/signing` | Offline, deterministic EIP-712 + EIP-1271 signing through a viem callback — Rust-identical signatures, no network |
| [`cow-gateway-cloudflare`](wasm/cow-gateway-cloudflare) | Cloudflare Worker | npm `/trading/edge` | An edge orderbook quote gateway with structured upstream error mapping (`503` + `Retry-After` / `502` / `400`) |

## Native (Rust)

One example today: a live reference **trading bot** under
[`native/trading-bot`](native/trading-bot), built on the published `cow-sdk`
facade (and its in-crate test doubles) — never individual leaf crates. It shows
environment-driven config, structured `tracing` telemetry, cooperative
cancellation, typed error handling, and operator subcommands — a real strategy
built end to end on the SDK surface.

```text
cargo run -p cow-trading-bot -- inspect      # read-only health probe
cargo run -p cow-trading-bot -- --help       # full command set
```

Further single-call Rust scenarios will land here as Cargo examples.
