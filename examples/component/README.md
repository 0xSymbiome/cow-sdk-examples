# Component examples

These examples consume the CoW SDK as **published WebAssembly components** —
language-neutral artifacts distributed through GHCR as OCI images, separate from
the npm `@symbiome-forge/cow-sdk-wasm` package and the native `cow-sdk` crate.

A component is a different door into the same audited SDK: a typed WIT contract
any component host can load. These examples pull the artifacts from GHCR with
`wkg`, run them from native Rust (Wasmtime) and Node (`jco`), and compose them
with `wac`.

| Example | What it shows |
| --- | --- |
| [`cow-engine-verify`](cow-engine-verify) | Reproduce a CoW order identity from the pure engine component, from Rust and Node, byte-identical to a committed golden |
| [`cow-agent-sandbox`](cow-agent-sandbox) | Compose a capability guard onto the published client and drive a live keys-out Sepolia trade from a capability-scoped host |

## The components

Three components are published to GHCR under `0xsymbiome`, sharing one WIT package
(`cow:protocol`):

- [`cow-sdk-component-engine`](https://github.com/orgs/0xSymbiome/packages/container/package/cow-sdk-component-engine)
  — pure order math, no host imports; runs in any component host, including the
  browser.
- [`cow-sdk-component-client-sync`](https://github.com/orgs/0xSymbiome/packages/container/package/cow-sdk-component-client-sync)
  — the stateful client (orderbook reads and writes, the trading lifecycle) over
  WASI 0.2; imports a host `signer`, `contract-read`, and `wasi:http`.
- [`cow-sdk-component-client-async`](https://github.com/orgs/0xSymbiome/packages/container/package/cow-sdk-component-client-async)
  — the same surface over WASI 0.3; published, no runnable example yet.

The client components run on native and server hosts (Wasmtime, Node), not in the
browser; the engine runs anywhere.

## Toolchain

- Rust `1.94.1` with `rustup target add wasm32-wasip2`.
- `wkg`, `wac`, `wasm-tools`, `just`: `cargo install wkg wac-cli wasm-tools just`.
- Node `>= 22` and `jco` for the JavaScript host.
