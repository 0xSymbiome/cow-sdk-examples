# Node.js Signer — Signing-Flavor WASM Example

A minimal Node.js (22 or 24) example that signs a CoW Protocol order with the
**`signing` flavor** of the TypeScript-callable WASM package. It runs offline and
deterministically — no network, no wallet extension, no funded key — and produces
the same EIP-712 and EIP-1271 signatures as the Rust SDK, because both are backed
by one Rust implementation.

The signer is [viem](https://viem.sh); the package stays wallet-library-agnostic
behind a typed callback. The key never enters the WASM — the SDK builds the
EIP-712 payload, viem signs it, and the SDK wraps the returned signature.

This example imports the published `@symbiome-forge/cow-sdk-wasm` package from its
`/signing` subpath.

## Run

```text
pnpm install
pnpm test
```

`pnpm test` type-checks (`tsc --noEmit`) and runs the Vitest suite.

## What it demonstrates

| Step | SDK call | Result |
| --- | --- | --- |
| Protocol values | `domainSeparator`, `orderTypedData`, `computeOrderUid` | Deterministic, network-free EIP-712 domain, typed data, and order UID |
| Sign (EOA) | `signOrderWithTypedDataSigner` + viem local account | `SignedOrderDto` with `signingScheme: "eip712"` |
| Sign (contract) | `signOrderWithEip1271` (same signer) | `SignedOrderDto` with `signingScheme: "eip1271"` |

The pure helpers are the parity anchor: the same Rust implementation backs the
native SDK and this package, so identical inputs yield identical outputs across
runtimes and across runs.

## How it maps to the SDK

The smallest surface for a signer service is the `/signing` subpath:

```ts
import type { TypedDataDefinition } from "viem";
import {
  orderTypedData,
  signOrderWithTypedDataSigner
} from "@symbiome-forge/cow-sdk-wasm/signing";

// The SDK hands your callback the EIP-712 envelope (plain `domain`, `types`,
// `primaryType`, and `message`); you return the signature.
const signed = await signOrderWithTypedDataSigner(order, chainId, owner, (envelope) =>
  account.signTypedData(envelope as unknown as TypedDataDefinition)
);
```

A real backend would then hand `signed.value` to an orderbook client (the
default or `/orderbook` flavor) to post it; this example stops at the signature
so it stays offline and deterministic.

## Notes

- **Flavor.** The `signing` flavor is the smallest artifact (no orderbook,
  trading, subgraph, or IPFS clients). It is the right import for signer services
  and HSM-facing adapters.
- **Key handling.** The demonstration key is a publicly published local-node test
  key, used only to produce a reproducible signature offline. Never put a funded
  key in source. The package never holds key material.
- **Choosing this package.** For most browser dapps and CowSwap-style UIs the
  upstream [`@cowprotocol/cow-sdk`](https://www.npmjs.com/package/@cowprotocol/cow-sdk)
  is the recommended, substantially smaller choice. Reach for this package when
  you need Rust-identical signing inside a TypeScript or Node.js host.

## Quality

The example is held to the same bar as the crates:

```text
pnpm run build   # tsc --noEmit, 0 type errors
pnpm test        # Vitest suite passes
```
