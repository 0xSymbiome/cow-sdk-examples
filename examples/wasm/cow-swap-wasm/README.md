# cow-swap-wasm — a client-side CoW swap dApp

A browser CoW Protocol swap interface on the **`trading` flavor** of the WASM
SDK, with **no backend**: the Rust SDK, compiled to WebAssembly, runs all
protocol logic — quoting, slippage, order-signing payloads, posting, tracking,
surplus, solver competition, TWAP, native wrap/unwrap, and cancellation.

[viem](https://viem.sh) owns the wallet, RPC, and ABI plumbing;
`@symbiome-forge/cow-sdk-wasm` owns the protocol. **No private key enters the
SDK** — it builds the EIP-712 payload, the wallet signs it. The SDK is called
directly in feature hooks, with no wrapper layer. The `/trading` subpath
resolves the portable `web` target, instantiated with one `initialize()` call.

## Run

```text
pnpm install
pnpm dev      # dev server
pnpm build    # tsc -b, then a static bundle in dist/
pnpm test     # build, then the Vitest suite
```

Connect a wallet and swap. **Sepolia** is free for end-to-end testing; mainnet
and the other supported networks are live.

## What it demonstrates

| Capability | SDK surface |
| --- | --- |
| Live market quote with full cost breakdown | `TradingClient.getQuote` → `QuoteResults` |
| Auto or manual slippage | `QuoteResults.suggestedSlippageBps` (Auto) / `TradeParams.slippageBps` (manual) |
| Sign + post a swap (gasless, wallet-signed) | `postSwapOrderFromQuote` + a typed-data callback |
| Limit orders, optionally partially fillable | `postLimitOrder` (`partiallyFillable`) |
| Custom recipient | `TradeParams.receiver` |
| Order expiry (swap minutes, limit days) | `validFor` |
| ERC-20 approval — exact or unlimited allowance | `getCowProtocolAllowance` + `buildApprovalTx` |
| Native-currency sells (on-chain eth-flow) | `buildSellNativeCurrencyTxFromQuote` |
| Wrap / unwrap native currency (ETH ↔ WETH) | `wrappedNativeToken` + `buildWrapTx` / `buildUnwrapTx` |
| Order tracking with live status | `OrderBookClient.getOrders` |
| Surplus captured for you | `getTotalSurplus` |
| Solver competition per order | `getOrderCompetitionStatus` |
| Cancellation | `signCancellationWithTypedDataSigner` + `cancelOrders` |
| TWAP conditional orders (via a Safe, EIP-1271) | `buildTwapCreateTransaction` / `buildTwapRemoveTransaction` + `buildAppData` |
| Multi-chain network switcher | `supportedChainIds` |
| Typed, specific error states | `CowError` + `isCowError` / `isRetryable` / `isUserRejection` / `retryAfterMs` |
| Transient-failure retry with backoff | `withRetry` |
| "Under the hood" inspector | `QuoteResults.orderTypedData`, `wasmVersion` |

Every row is exercised by code in `src/`.

## How it maps to the SDK

Feature hooks call the SDK directly. The only shared glue is the wallet/SDK
seam — two adapters in [`src/lib/cow-callbacks.ts`](src/lib/cow-callbacks.ts)
that bridge viem to the SDK's typed-data and contract-read callbacks:

```ts
import type { TypedDataSignerCallback } from '@symbiome-forge/cow-sdk-wasm/trading'

// The SDK hands the wallet a ready EIP-712 envelope; viem signs it and the key
// stays in the wallet. (The adapter also drops the redundant EIP712Domain type
// that viem re-derives — see src/lib/cow-callbacks.ts.)
const signer: TypedDataSignerCallback = (envelope) =>
  walletClient.signTypedData({ account, ...envelope })

const trading = new TradingClient({ chainId, appCode: 'cow-swap-wasm' })
const quote = (await trading.getQuote(swapParameters)).value
const { orderId } = (await trading.postSwapOrderFromQuote(quote, owner, signer)).value
```

`postSwapOrderFromQuote` re-uses the resolved quote, so the amounts the user
confirms are the amounts that get signed. `OrderBookClient` then tracks
`orderId` to a terminal state and reports surplus and solver competition.

## Notes

- **Flavor + target.** The `trading` flavor is the order-lifecycle surface. The
  `/trading` subpath resolves the portable `web` target — `initialize()` loads
  the wasm as a normal asset, so it works on any bundler and on static hosting.
- **Settings.** A gear panel maps each control to an order field: MEV-protected
  slippage (Auto follows the per-quote `suggestedSlippageBps`, or a manual
  percent), expiry (`validFor`), recipient (`receiver`), approval (exact or
  unlimited), and — on limit orders — partial fills (`partiallyFillable`).
- **MEV protection.** Orders settle in batch auctions off the public mempool, so
  they are MEV-protected by construction — nothing to toggle.
- **Key handling.** The SDK never holds key material; the wallet signs every
  order and cancellation through a callback.
- **Errors are states.** Every SDK call throws a `CowError` — an `Error`
  subclass that is also a discriminated union keyed by `kind`. The app branches
  on the SDK's verdict through the shipped helpers (`isUserRejection`,
  `isRetryable`, `retryAfterMs`) and refines an orderbook rejection by its
  `errorType`. See [`src/lib/cow-errors.ts`](src/lib/cow-errors.ts).
- **Retry.** The quote fetch runs through `withRetry`, which retries only
  SDK-classified-retryable failures and honours `Retry-After`.
- **Mobile.** Responsive single-column layout with bottom-sheet modals; wallet
  connection uses EIP-6963.
- **Console noise.** Wallet extensions inject content scripts that log their own
  diagnostics; those are not from this app.
- **Scope.** Market and limit swaps, TWAP (via a Safe), ERC-20 approvals,
  native-currency buy and sell (eth-flow), and wrap/unwrap. Hooks are outside
  the WASM surface and are not shown rather than faked.
- **Deployment.** `pnpm build` emits a static bundle in `dist/` with no server;
  `base: './'` keeps assets portable. Published to GitHub Pages at
  <https://0xsymbiome.github.io/cow-sdk-examples/cow-swap-wasm> via
  `.github/workflows/deploy-cow-swap-wasm.yml`. The single-threaded wasm needs
  no cross-origin-isolation headers.
- **Choosing this package.** For a minimal-bundle production dapp,
  [`@cowprotocol/cow-sdk`](https://www.npmjs.com/package/@cowprotocol/cow-sdk)
  is smaller. Reach for this one when you want a single Rust implementation
  behind both backend and frontend, or the same engine in the browser and on
  the edge.

## Stack

React 19 (React Compiler) + Vite + TypeScript + viem + TanStack Query. viem
handles wallet discovery (EIP-6963), chain switching, balances, and the
ABI-level reads the SDK delegates; the SDK handles everything CoW.

## Quality

Every claim above is gated:

```text
pnpm run build   # tsc -b (0 type errors) + vite build
pnpm test        # build, then the Vitest suite
pnpm lint        # ESLint with the React Compiler rule set
```
