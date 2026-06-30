# cow-agent-sandbox

Compose a capability guard onto the **published** CoW client component, then drive
it from a capability-scoped native host. The result is a confined "trade on CoW"
tool: the host hands the trading logic exactly three capabilities — a signer (the
key stays in the host), a contract reader, and `wasi:http` — and nothing else is
reachable.

This is the case the Component Model exists for, and one the npm and native SDK
lanes do not reach: least-privilege confinement of money-moving code, plus a
policy snapped onto a component you did not author and enforced in the binary.

> **Testnet only.** `trade` targets Sepolia and signs with a throwaway test
> wallet. Never use a wallet holding real funds.

## What it demonstrates

| Capability | How |
| --- | --- |
| Compose a guard onto a client you did not author | `wac plug` connects the guard's `cow:protocol/signer` export to the published client's matching import |
| A signature cap enforced in the binary | the guard counts signatures and denies past the cap, then delegates to the host; the client cannot exceed it |
| A least-privilege host | the host grants only `signer` + `contract-read` + `wasi:http`, with no environment, no filesystem, and no other network |
| Keys-out, node-out | the host holds the k256 key and answers the signer import; the key never enters the wasm |
| A live trade with no JavaScript | the composed artifact quotes, signs, and posts a real Sepolia order from pure Rust |

## Run

Prerequisites: Rust `1.94.1` with the `wasm32-wasip2` target, and `wkg`, `wac`,
`wasm-tools`, `just` (`cargo install wkg wac-cli wasm-tools just`).

```bash
just prove        # offline: build the guard, show the cap deny the 4th signature
just compose      # pull the client, build the guard, plug them, validate the artifact
just trade        # live Sepolia quote through the composed artifact
```

`prove` needs no key and no network. For `trade`, copy `.env.example` to `.env`,
set `COW_BOT_PRIVATE_KEY` to a funded Sepolia test wallet, and set
`COW_BOT_WRITE=yes`; a successful post prints the order UID and an explorer link.

## How it maps to the component

- `guard/` is a small component that imports `cow:protocol/signer` (the raw host
  signer) and exports `cow:protocol/signer` (a guarded one). `wac plug` wires its
  export into the published client's import, so the composed artifact still
  imports `cow:protocol/signer` — now the guard's — and the host satisfies it
  unchanged.
- `wit/` holds the cow:protocol contract, extracted from the published artifact,
  and the cow-only world the host binds.
- `host-rust/src/main.rs` has two commands. `prove-cap` instantiates the guard
  with a stub signer and calls it past the cap. `trade` loads
  `dist/cow-trader-guarded.wasm`, builds a `WasiCtx` with stdio only, holds the
  key, and calls `trading.quote` then `trading.post-swap-from-quote`.

## What the host grants, and what it does not

The host wires three capabilities into the linker and nothing else:

- `cow:protocol/signer` — the host signs a 32-byte digest with k256; the key
  lives in the host process, never in the guest.
- `cow:protocol/contract-read` — unused on the quote/post path (a stub).
- `wasi:http` — the only outbound channel, used to reach the CoW orderbook API.

The `WasiCtx` inherits no environment (so the key in the host environment cannot
cross the boundary), no filesystem, and no other sockets. The guard caps
signatures inside the composed binary. The trading logic is confined to its
declared surface.

## Notes

- The pinned tag `0.1.0-alpha.9` keeps the build reproducible; `just wit`
  refreshes the committed contract after a version bump.
