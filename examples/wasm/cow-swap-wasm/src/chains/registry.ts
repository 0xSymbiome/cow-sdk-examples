import { supportedChainIds } from '@symbiome-forge/cow-sdk-wasm/trading'
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  ink,
  linea,
  mainnet,
  plasma,
  polygon,
  sepolia,
  type Chain,
} from 'viem/chains'

import { COW_EXPLORER_BASE } from '../config'

// EIP-7528 native-asset sentinel: the address CoW Protocol uses to represent a
// chain's native currency (e.g. as the sell token for native-currency sells).
export const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const

export interface ChainMeta {
  /** The viem chain definition (RPC URLs, native currency, block explorers). */
  chain: Chain
  /** Display label for the network switcher. */
  label: string
  /** Native currency symbol (ETH, xDAI, POL, …). */
  nativeSymbol: string
  /** Block explorer base for transaction and address links. */
  explorerBase: string
  /** Path segment used by CoW Explorer order links. */
  cowNetwork: string
  testnet: boolean
}

// Metadata for the chains this UI fully supports. The network switcher renders
// the intersection of this registry with `supportedChainIds()`, so the SDK is
// the source of truth for which chains are live — this table only adds the
// display data the SDK does not carry.
const REGISTRY: Record<number, ChainMeta> = {
  1: { chain: mainnet, label: 'Ethereum', nativeSymbol: 'ETH', explorerBase: 'https://etherscan.io', cowNetwork: 'mainnet', testnet: false },
  100: { chain: gnosis, label: 'Gnosis Chain', nativeSymbol: 'xDAI', explorerBase: 'https://gnosisscan.io', cowNetwork: 'xdai', testnet: false },
  8453: { chain: base, label: 'Base', nativeSymbol: 'ETH', explorerBase: 'https://basescan.org', cowNetwork: 'base', testnet: false },
  42161: { chain: arbitrum, label: 'Arbitrum One', nativeSymbol: 'ETH', explorerBase: 'https://arbiscan.io', cowNetwork: 'arbitrum_one', testnet: false },
  137: { chain: polygon, label: 'Polygon', nativeSymbol: 'POL', explorerBase: 'https://polygonscan.com', cowNetwork: 'polygon', testnet: false },
  56: { chain: bsc, label: 'BNB Chain', nativeSymbol: 'BNB', explorerBase: 'https://bscscan.com', cowNetwork: 'bnb', testnet: false },
  43114: { chain: avalanche, label: 'Avalanche', nativeSymbol: 'AVAX', explorerBase: 'https://snowtrace.io', cowNetwork: 'avalanche', testnet: false },
  59144: { chain: linea, label: 'Linea', nativeSymbol: 'ETH', explorerBase: 'https://lineascan.build', cowNetwork: 'linea', testnet: false },
  57073: { chain: ink, label: 'Ink', nativeSymbol: 'ETH', explorerBase: 'https://explorer.inkonchain.com', cowNetwork: 'ink', testnet: false },
  9745: { chain: plasma, label: 'Plasma', nativeSymbol: 'XPL', explorerBase: 'https://plasmascan.to', cowNetwork: 'plasma', testnet: false },
  11155111: { chain: sepolia, label: 'Sepolia', nativeSymbol: 'ETH', explorerBase: 'https://sepolia.etherscan.io', cowNetwork: 'sepolia', testnet: true },
}

export function chainMeta(chainId: number): ChainMeta | undefined {
  return REGISTRY[chainId]
}

/** Chains the SDK supports and this UI has display metadata for. */
export function supportedChains(): ChainMeta[] {
  return Array.from(supportedChainIds())
    .map((id) => REGISTRY[id])
    .filter((meta): meta is ChainMeta => meta !== undefined)
}

export function isSupportedChain(chainId: number): boolean {
  return Array.from(supportedChainIds()).includes(chainId)
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  const base = REGISTRY[chainId]?.explorerBase ?? 'https://etherscan.io'
  return `${base}/tx/${txHash}`
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const base = REGISTRY[chainId]?.explorerBase ?? 'https://etherscan.io'
  return `${base}/address/${address}`
}

/** The user-facing CoW Explorer page for an order. */
export function cowExplorerOrderUrl(chainId: number, orderUid: string): string {
  const network = REGISTRY[chainId]?.cowNetwork ?? 'mainnet'
  return `${COW_EXPLORER_BASE}/${network}/orders/${orderUid}`
}
