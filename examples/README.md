# Examples

The CoW SDK cookbook. Examples are grouped by runtime and published incrementally; this
catalog lists what is currently available.

## Native (Rust)

Facade-only scenarios under [`native/`](native), each a runnable Cargo example that imports
the `cow-sdk` facade (and its in-crate test doubles). Deterministic scenarios use mocks or
wiremock and run in CI; scenarios that require a live network or wallet are opt-in.

```text
cargo run -p cow-sdk-examples-native --example <scenario>
```

_Scenarios are being published; this section lists each as it lands._

## WASM / TypeScript

Standalone projects under [`wasm/`](wasm), each depending on the published
`@symbiome-forge/cow-sdk-wasm` package and one of its flavor subpaths. Each project
carries its own README with build and run instructions.

| Project | Runtime | Surface | Demonstrates |
| --- | --- | --- | --- |
| [`cow-signer-node`](wasm/cow-signer-node) | Node.js ≥ 22 | npm `/signing` | offline, deterministic EIP-712 + EIP-1271 order signing through a viem callback |
| [`cow-gateway-cloudflare`](wasm/cow-gateway-cloudflare) | Cloudflare Worker | npm `/cloudflare` | an edge orderbook quote gateway with structured upstream error mapping (`503` + `Retry-After` / `502` / `400`) |

## Advanced cookbook

Beyond single-call recipes, the cookbook will include advanced, multi-step bots for both the
native and WASM runtimes, demonstrating end-to-end strategies built on the SDK surface.
