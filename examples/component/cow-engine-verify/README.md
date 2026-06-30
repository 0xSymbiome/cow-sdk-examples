# cow-engine-verify

Reproduce a CoW Protocol order identity from the **published engine component** —
pulled from GHCR as an OCI artifact — in two language hosts, native Rust and Node,
and assert both reproduce the committed golden byte for byte.

The engine world declares no host imports: no key, no node, no network. It is
pure, deterministic order math (UID, EIP-712 digest, chain data, gas-free tx
builders, the quote pipeline), so the same `.wasm` produces the same bytes
wherever it runs. This is the trustless primitive a wallet or an agent uses to
check what it is about to sign, without trusting an SDK.

## What it demonstrates

| Capability | How |
| --- | --- |
| One artifact, two hosts, identical output | Rust/Wasmtime and Node/jco load the same `engine.wasm` and reproduce the golden UID and digest |
| Deterministic order identity | `order.uid` and `order.digest` over a fixed order equal the committed `golden.json` |
| Cross-build parity | the digest matches the SDK's native Rust golden — the component and the native build agree |
| Component distribution | the artifact is pulled from GHCR by version tag, not built from source |

## Run

Prerequisites: Rust `1.94.1` with the `wasm32-wasip2` target, Node `>= 22`, and
`wkg`, `just` (`cargo install wkg just`). `wasm-tools` is needed only to refresh
the committed contract.

```bash
just                # fetch the pinned engine, then verify from Rust and Node
just verify-rust    # cargo run --manifest-path host-rust/Cargo.toml
just verify-node    # pnpm install && pnpm test  (jco transpile + node verify.mjs)
```

Both hosts print the UID and digest and assert they equal `golden.json`.

## How it maps to the component

- `wit/engine.wit` is the engine's contract, extracted from the published
  artifact, so the Rust bindings cannot drift from what ships.
- `host-rust/src/main.rs` binds the engine world with `wasmtime::component::bindgen!`,
  wires only standard WASI (the engine's incidental std use), and calls
  `order.uid`, `order.digest`, and `chains.supported-chain-ids`.
- `verify.mjs` transpiles the same artifact with `jco` and calls the same exports.
  jco maps `list<u64>` to a `BigUint64Array`.

## Notes

- The pinned tag `0.1.0-alpha.10` keeps the build reproducible; bump it and run
  `just wit` to refresh the committed contract.
