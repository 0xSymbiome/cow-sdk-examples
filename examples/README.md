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
`@symbiome-forge/cow-sdk-wasm` package and one of its flavor subpaths:

- **Browser (Rust → WASM):** a wallet-driven trade flow.
- **Node:** offline signing and orderbook flows.
- **Cloudflare Worker:** an edge orderbook gateway.

Each project carries its own README with build and run instructions.

_Projects are being published; this section lists each as it lands._

## Advanced cookbook

Beyond single-call recipes, the cookbook will include advanced, multi-step bots for both the
native and WASM runtimes, demonstrating end-to-end strategies built on the SDK surface.
