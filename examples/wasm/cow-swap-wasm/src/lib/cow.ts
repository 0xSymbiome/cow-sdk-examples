import {
  OrderBookClient,
  TradingClient,
  initialize,
  type OrderBookClientConfig,
  type TradingClientConfig,
} from '@symbiome-forge/cow-sdk-wasm/trading'

import { APP_CODE } from '../config'

// Construction and lifecycle for the WASM SDK clients: one-time module
// initialization and a per-chain client cache. The clients are module-scoped
// singletons that live for the whole page session — the browser reclaims the wasm
// instance on unload — so they are deliberately NOT disposed on a React unmount.
// Freeing a client there would race an in-flight quote/orders request still
// resolving inside the wasm; the resumed future would then read freed memory
// (a "memory access out of bounds" trap). `disposeChain`/`disposeAll` remain for
// consumers that create and tear down clients dynamically.

let initialized: Promise<void> | undefined

/**
 * Idempotently initialize the wasm module. The `web` target fetches and
 * instantiates it here; `bundler`/`nodejs` instantiate on import and resolve
 * immediately — so one initialization shape works across every target.
 */
export function ensureCowReady(): Promise<void> {
  initialized ??= initialize()
  return initialized
}

const tradingClients = new Map<number, TradingClient>()
const orderBookClients = new Map<number, OrderBookClient>()

/** The high-level trade-lifecycle client for a chain (quote, approve, sign, post). */
export function getTradingClient(chainId: number): TradingClient {
  let client = tradingClients.get(chainId)
  if (!client) {
    const config: TradingClientConfig = { chainId, appCode: APP_CODE }
    client = new TradingClient(config)
    tradingClients.set(chainId, client)
  }
  return client
}

/** The direct orderbook client for a chain (tracking, trades, surplus, cancel). */
export function getOrderBookClient(chainId: number): OrderBookClient {
  let client = orderBookClients.get(chainId)
  if (!client) {
    const config: OrderBookClientConfig = { chainId }
    client = new OrderBookClient(config)
    orderBookClients.set(chainId, client)
  }
  return client
}

/** Release the wasm-held client resources for one chain (e.g. on network switch). */
export function disposeChain(chainId: number): void {
  tradingClients.get(chainId)?.dispose()
  orderBookClients.get(chainId)?.dispose()
  tradingClients.delete(chainId)
  orderBookClients.delete(chainId)
}

/** Release every cached client. Call on teardown. */
export function disposeAll(): void {
  for (const chainId of new Set([...tradingClients.keys(), ...orderBookClients.keys()])) {
    disposeChain(chainId)
  }
}
