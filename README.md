# cow-sdk-examples

[![ci](https://github.com/0xSymbiome/cow-sdk-examples/actions/workflows/ci.yml/badge.svg)](https://github.com/0xSymbiome/cow-sdk-examples/actions/workflows/ci.yml) [![License GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-1F6FEB)](LICENSE)

Reference-grade, runnable examples for the [CoW Protocol](https://cow.fi) Rust SDK
— across native Rust and the JavaScript/TypeScript WebAssembly bindings. Each one
is a study in **how to build correctly** on the SDK, not just *that it works*.

Three rules hold for everything in this repository, and CI enforces them — so what
you read is what you get:

- **Published artifacts only.** Every example depends on a released artifact —
  [`cow-sdk`](https://crates.io/crates/cow-sdk) from crates.io,
  [`@symbiome-forge/cow-sdk-wasm`](https://www.npmjs.com/package/@symbiome-forge/cow-sdk-wasm)
  from npm, or one of the WebAssembly component packages from
  [GHCR](https://github.com/orgs/0xSymbiome/packages) — pinned with a committed
  lockfile or tag. Nothing imports the SDK source tree, so an example is exactly
  what a consumer gets — never a privileged build.
- **Every claim is runnable.** Each example carries its own typecheck/build/test
  gate and must pass it; a README never describes behavior the code doesn't have.
- **The host owns its keys.** The WASM examples connect a real wallet and sign
  through callbacks. No private key enters the SDK — in any example, on any path.

```text
cargo add cow-sdk
npm install @symbiome-forge/cow-sdk-wasm@alpha
wkg oci pull ghcr.io/0xsymbiome/cow-sdk-component-engine:0.1.0-alpha.9
```

## The catalog

Grouped by runtime; each example carries its own README. The full index with run
instructions is in [`examples/`](examples/README.md).

| Example | Runtime | Depends on | Demonstrates |
| --- | --- | --- | --- |
| [`cow-swap-wasm`](examples/wasm/cow-swap-wasm) | Browser (Vite + React) | npm `…/trading` | **Flagship** — a complete client-side swap dApp: the full order lifecycle (quote → sign → post → track → surplus → cancel) with no backend |
| [`cow-signer-node`](examples/wasm/cow-signer-node) | Node.js ≥ 22 | npm `…/signing` | Offline, deterministic EIP-712 + EIP-1271 order signing through a viem callback |
| [`cow-gateway-cloudflare`](examples/wasm/cow-gateway-cloudflare) | Cloudflare Worker | npm `…/trading/edge` | An edge orderbook quote gateway with typed upstream error mapping |
| [`trading-bot`](examples/native/trading-bot) | Native (Rust) | `cow-sdk` | A live reference trading bot: env-driven config, `tracing` telemetry, cooperative cancellation, typed errors |
| [`cow-engine-verify`](examples/component/cow-engine-verify) | Native + Node | [`cow-sdk-component-engine`](https://github.com/orgs/0xSymbiome/packages/container/package/cow-sdk-component-engine) | Reproduce a CoW order identity from the pure engine component in two hosts, byte-identical to the native golden |
| [`cow-agent-sandbox`](examples/component/cow-agent-sandbox) | Native (Rust) | [`cow-sdk-component-client-sync`](https://github.com/orgs/0xSymbiome/packages/container/package/cow-sdk-component-client-sync) | Compose a capability guard onto the published client and drive a live keys-out Sepolia trade from a capability-scoped host |

The flagship is **[`cow-swap-wasm`](examples/wasm/cow-swap-wasm)** — a hosted,
fully client-side CoW swap interface where [viem](https://viem.sh) owns the
wallet, RPC, and ABI plumbing and the SDK owns *every line* of protocol logic.

## How these examples are built

The discipline is the demonstration. Each example:

- pins the published SDK exactly and commits its lockfile, so builds are
  reproducible and the example can never silently track unreleased behavior;
- passes its own gate — `pnpm test` (a `tsc` typecheck plus the Vitest suite) for
  the TypeScript projects, `cargo` build/run for Rust — wired into CI;
- carries no internal-lifecycle references, machine paths, or real keys; only
  clearly-labelled public dev/test material;
- is registered in the [catalog](examples/README.md), so an undocumented example
  fails the repository's coherence check.

This mirrors the SDK's own posture — correctness enforced by the build, not
trusted to prose. See the SDK's
[principles](https://github.com/0xSymbiome/cow-rs/blob/main/docs/principles.md).

## Layout

```text
examples/
  native/    # Rust — the reference trading bot (facade-only; more scenarios as they land)
  wasm/      # standalone browser, Node, and Cloudflare Worker projects (own lockfiles)
  component/ # published OCI components, hosted from Rust (Wasmtime) and Node (jco), composed with wac
xtask/       # repository task runner (e.g. cargo run-deterministic-examples)
```

The native trading bot is facade-only: it imports the `cow-sdk` facade (and its
in-crate test doubles), never individual leaf crates. WASM/TypeScript projects
depend on the published npm package and one of its flavor subpaths —
`/trading` (with `/trading/edge` for Workers, Deno, and Vercel Edge),
`/orderbook`, `/signing`, or the default — picking the smallest one their calls
need.

## Toolchain

- Rust edition `2024`, MSRV `1.94.0`, pinned contributor toolchain `1.94.1`
  (`rust-toolchain.toml`).
- Node `>= 22` and pnpm `11.7.0` for the TypeScript/WASM projects.

## Conventions

Commits follow Conventional Commits (`type(scope): summary` with `- ` body
bullets), validated by a local hook and the `commit-format` workflow. Enable the
hook once after cloning:

```text
git config core.hooksPath .githooks
git config commit.template .github/commit-template.md
```

## License

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
