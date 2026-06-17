# cow-sdk-examples

[![ci](https://github.com/0xSymbiome/cow-sdk-examples/actions/workflows/ci.yml/badge.svg)](https://github.com/0xSymbiome/cow-sdk-examples/actions/workflows/ci.yml) [![License GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-1F6FEB)](LICENSE)

Runnable examples and an advanced cookbook for the CoW Protocol Rust SDK,
covering both native Rust and browser/Node/Workers (WASM) runtimes.

Every example builds against the **published** SDK artifacts — nothing here depends
on the SDK source tree:

- Rust: [`cow-sdk`](https://crates.io/crates/cow-sdk) · docs at [docs.rs/cow-sdk](https://docs.rs/cow-sdk)
- TypeScript/WASM: [`@symbiome-forge/cow-sdk-wasm`](https://www.npmjs.com/package/@symbiome-forge/cow-sdk-wasm)

```text
cargo add cow-sdk
npm install @symbiome-forge/cow-sdk-wasm@alpha
```

## Status

The repository foundation is in place — workspace, pinned toolchain, lint posture,
dependency policy, and the CI quality gate — aligned with the SDK's own conventions.
The example catalog is published incrementally; see [`examples/`](examples/README.md)
for what is currently available.

## Layout

```text
examples/
  native/   # Rust scenarios — facade-only, runnable, mock/wiremock-driven by default
  wasm/     # standalone Node and Cloudflare Worker projects
xtask/      # repository task runner (e.g. cargo run-deterministic-examples)
```

Native scenarios are facade-only: they import the `cow-sdk` facade (and its in-crate
test doubles), never individual leaf crates. WASM/TypeScript projects depend on the
published npm package and one of its flavor subpaths (`/orderbook`, `/signing`,
`/cloudflare`).

## Running an example

The advanced native cookbook is a live reference trading bot,
[`examples/native/trading-bot`](examples/native/trading-bot):

```text
cargo run -p cow-trading-bot -- inspect      # read-only health probe
cargo run -p cow-trading-bot -- --help       # full command set
```

Single-call Rust scenarios run as Cargo examples (`cargo run -p
cow-sdk-examples-native --example <scenario>`) as they are published; scenarios
that exercise the native Alloy adapters enable the matching feature, e.g.
`--features alloy`. WASM/TypeScript projects each carry their own README with
build and run instructions.

## Toolchain

- Rust edition `2024`, MSRV `1.94.0`, pinned contributor toolchain `1.94.1`
  (`rust-toolchain.toml`).
- Node `>= 22` for the TypeScript/WASM projects.

## Conventions

Commits follow Conventional Commits (`type(scope): summary` with `- ` body bullets) and are
validated by a local hook and the `commit-format` workflow. Enable the hook once after cloning:

```text
git config core.hooksPath .githooks
git config commit.template .github/commit-template.md
```

## License

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE).
