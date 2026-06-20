# cow-swap-wasm — a complete CoW swap dApp, entirely client-side

A hosted, browser-based CoW Protocol swap interface built on the **`trading`
flavor** of the TypeScript-callable WASM package. It runs with **no backend**: the
Rust SDK, compiled to WebAssembly, performs *all* protocol logic — quoting, slippage suggestion, order signing
payloads, posting, tracking, surplus, solver competition, native wrap/unwrap, and cancellation
— straight from the browser.

The division of labor is the lesson. [viem](https://viem.sh) owns the wallet, RPC,
and ABI plumbing; `@symbiome-forge/cow-sdk-wasm` owns the CoW Protocol. **No
private key ever enters the SDK** — it builds the EIP-712 payload and the wallet
signs it. There is no wrapper layer: the SDK is called directly inside feature
hooks, so every call site reads like the package's own surface.

This example imports the published package from its `/trading` subpath; in the
browser that resolves the `trading` flavor's `web` target, instantiated with a
single `initialize()` call.

## Run

```text
pnpm install
pnpm dev      # start the dev server
pnpm build    # type-check (tsc -b) and produce a static bundle in dist/
pnpm test     # build, then run the Vitest suite
```

Open the dev server, connect an injected wallet (MetaMask, Rabby, Frame, …), and
swap. **Sepolia** is supported for free end-to-end testing; mainnet and the other
supported networks are live.

## What it demonstrates

| Capability | SDK surface |
| --- | --- |
| Live market quote with full cost breakdown | `TradingClient.getQuote` → `QuoteResultsDto` |
| Auto or manual slippage | `QuoteResultsDto.suggestedSlippageBps` (Auto) / `SwapParametersInput.slippageBps` (manual) |
| Sign + post a swap (gasless, wallet-signed) | `postSwapOrderFromQuote` + a typed-data callback |
| Limit orders, optionally partially fillable | `postLimitOrder` (`partiallyFillable`) |
| Custom recipient | `SwapParametersInput.receiver` |
| Order expiry (swap minutes, limit days) | `validFor` |
| ERC-20 approval — exact or unlimited allowance | `getCowProtocolAllowance` + `buildApprovalTx` |
| Native-currency sells (on-chain eth-flow) | `buildSellNativeCurrencyTxFromQuote` |
| Wrap / unwrap native currency (ETH ↔ WETH) | `wrappedNativeToken` + `buildWrapTx` / `buildUnwrapTx` |
| Order tracking with live status | `OrderBookClient.getOrders` |
| Surplus captured for you | `getTotalSurplus` |
| Solver competition per order | `getOrderCompetitionStatus` |
| Cancellation | `signCancellationWithTypedDataSigner` + `cancelOrders` |
| Multi-chain network switcher | `supportedChainIds` |
| Typed, specific error states | the thrown `CowError` + `isCowError` / `isRetryable` / `isUserRejection` / `retryAfterMs` |
| Transient-failure retry with backoff | `withRetry` (honours the SDK's retryable verdict and `Retry-After`) |
| "Under the hood" inspector | `QuoteResultsDto.orderTypedData`, `wasmVersion` |

Every row is exercised by code in `src/`; nothing here is illustrative-only.

## How it maps to the SDK

Feature hooks call the SDK directly. The only shared glue is the wallet/SDK seam —
two small adapters in [`src/lib/cow-callbacks.ts`](src/lib/cow-callbacks.ts) that
bridge viem to the SDK's typed-data and contract-read callbacks:

```ts
import type { TypedDataSignerCallback } from '@symbiome-forge/cow-sdk-wasm/trading'

// The SDK hands the wallet a ready EIP-712 envelope; viem signs it and the key
// stays in the wallet. (The real adapter also drops the redundant EIP712Domain
// type that viem re-derives — see src/lib/cow-callbacks.ts.)
const signer: TypedDataSignerCallback = (envelope) =>
  walletClient.signTypedData({ account, ...envelope })

const trading = new TradingClient({ chainId, appCode: 'cow-swap-wasm' })
const quote = (await trading.getQuote(swapParameters)).value
const { orderId } = (await trading.postSwapOrderFromQuote(quote, owner, signer)).value
```

`getQuote` returns a fully resolved quote that `postSwapOrderFromQuote` re-uses, so
the amounts the user confirms are the amounts that get signed — no second quote, no
drift. `OrderBookClient` then tracks `orderId` to a terminal state and reports
surplus and solver competition.

## Notes

- **Flavor.** The `trading` flavor is the order-lifecycle surface (quote, sign,
  post, track, cancel). A browser dApp imports the `/trading` subpath, which
  resolves the portable `web` target: the app calls `initialize()` once and the
  wasm loads as a normal asset, so it works across every bundler and on static
  hosting (the bundler-target `import * as wasm` integration is not portable there).
- **Settings.** A gear-icon panel exposes the order controls, each mapped to a
  field on the quote/order params: MEV-protected slippage (Auto follows the
  protocol's per-quote `suggestedSlippageBps`, or set a manual percent), order
  expiry (`validFor`), a custom recipient (`receiver`), the approval amount (exact
  or unlimited), and — on limit orders — partial fills (`partiallyFillable`).
  Nothing is mocked.
- **MEV protection.** CoW settles orders in batch auctions off the public mempool,
  so they are protected from MEV by construction; the app states this, with nothing
  to toggle.
- **Mobile.** The layout is responsive — single column, bottom-sheet modals, and
  safe-area insets. Wallet connection uses EIP-6963 (covering a wallet's in-app
  browser); on a plain mobile browser it offers in-app-browser deep-links.
- **Key handling.** Connect a real wallet. The SDK never holds key material; the
  wallet signs every order and cancellation through a callback.
- **Console output.** Browser wallet extensions inject a content script that logs
  its own diagnostics (for example `ObjectMultiplex` notices or an `EventEmitter`
  listener warning). Those come from the extension, not this app, and are safe to
  ignore.
- **Errors are states, not strings.** Every SDK call throws a `CowError` — a real
  `Error` subclass that is also a discriminated union keyed by `kind`. The SDK
  classifies the failure; the app reads that verdict through the shipped helpers
  (`isUserRejection` → soft-cancel a declined signature, `isRetryable` /
  `retryAfterMs` → the transient-retry budget) and refines an orderbook rejection
  by its `errorType` tag, telling `InsufficientAllowance` (approve the token) from
  `InsufficientBalance` (add funds) where the coarse `category` cannot. See
  [`src/lib/cow-errors.ts`](src/lib/cow-errors.ts).
- **Transient failures retry themselves.** The quote fetch runs through `withRetry`,
  which retries only the failures the SDK classifies as retryable and waits the
  server's `Retry-After` when present — a rate-limit or 5xx blip recovers without a
  visible error, while a rejection decided on the request is surfaced at once. The
  inspector reports any retry as it happens.
- **Scope.** Market and limit swaps, ERC-20 approvals, buying native currency,
  selling native currency (via CoW's on-chain eth-flow), and wrapping or unwrapping
  native currency (ETH ↔ WETH) are all supported. Advanced order types (TWAP, hooks)
  are outside the current WASM surface and are deliberately not shown rather than
  faked.
- **Deployment.** `pnpm build` emits a static bundle in `dist/` with no server
  component. `base: './'` keeps assets portable across subpaths, so this repo
  publishes it to GitHub Pages at
  <https://0xsymbiome.github.io/cow-sdk-examples/cow-swap-wasm> through
  `.github/workflows/deploy-cow-swap-wasm.yml`. The single-threaded wasm needs no
  cross-origin-isolation headers, and the bundle hosts on any other static
  platform too.
- **Choosing this package.** For a standard production browser dapp where minimal
  bundle size dominates, the upstream
  [`@cowprotocol/cow-sdk`](https://www.npmjs.com/package/@cowprotocol/cow-sdk) is
  the smaller, recommended choice. Reach for this package when you want a single
  Rust implementation behind both your backend and frontend, or the exact same
  engine on the browser and the edge.

## Stack

React 19 (with the React Compiler) + Vite + TypeScript + viem + TanStack Query.
viem handles wallet discovery (EIP-6963), chain switching, balances, and the
ABI-level reads the SDK delegates; the SDK handles everything CoW.

## Quality

The example is held to the same bar as the crates — every claim above is gated:

```text
pnpm run build   # tsc -b (0 type errors) + vite build
pnpm test        # build, then the Vitest suite
pnpm lint        # ESLint with the React Compiler rule set
```
