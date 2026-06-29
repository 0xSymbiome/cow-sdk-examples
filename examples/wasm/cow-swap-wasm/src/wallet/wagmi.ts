import { createConfig, http, type CreateConnectorFn } from 'wagmi'
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
} from 'wagmi/chains'

import { WALLETCONNECT_PROJECT_ID } from '../config'

const APP_NAME = 'CoW Swap · WASM SDK'

// wagmi owns the connection lifecycle. EIP-6963 discovery (on by default) lists
// installed browser wallets (MetaMask, Rabby, …) by name with their own icons, so no
// explicit injected() connector is configured — it would only duplicate discovery as a
// generic "Injected". The chain set matches the SDK's supported chains so the network
// switcher can reach any of them.
const chains = [mainnet, gnosis, base, arbitrum, polygon, bsc, avalanche, linea, ink, plasma, sepolia] as const

export const wagmiConfig = createConfig({
  chains,
  transports: {
    [mainnet.id]: http(),
    [gnosis.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
    [avalanche.id]: http(),
    [linea.id]: http(),
    [ink.id]: http(),
    [plasma.id]: http(),
    [sepolia.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}

// WalletConnect and Coinbase ship large SDKs — WalletConnect also pulls in its AppKit
// QR modal — so their connector factories are imported lazily. Neither lands in the
// eager bundle or initializes at startup; the `wagmi/connectors` chunk loads only when
// a user actually picks one. (Injected wallets need no factory — EIP-6963 discovery
// covers them with no extra weight.) The trade-off is that an on-demand connector is
// not registered for auto-reconnect, so a WalletConnect/Coinbase session is re-paired
// on the next visit rather than restored silently.
export async function createWalletConnectConnector(): Promise<CreateConnectorFn> {
  const { walletConnect } = await import('wagmi/connectors')
  return walletConnect({
    projectId: WALLETCONNECT_PROJECT_ID,
    showQrModal: true,
    metadata: {
      name: APP_NAME,
      description: 'CoW Protocol Rust SDK compiled to WebAssembly',
      url: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
      icons: [],
    },
  })
}

export async function createCoinbaseConnector(): Promise<CreateConnectorFn> {
  const { coinbaseWallet } = await import('wagmi/connectors')
  return coinbaseWallet({ appName: APP_NAME })
}
