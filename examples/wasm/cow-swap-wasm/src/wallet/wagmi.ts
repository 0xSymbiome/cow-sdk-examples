import { createConfig, http } from 'wagmi'
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
import { coinbaseWallet, walletConnect } from 'wagmi/connectors'

import { WALLETCONNECT_PROJECT_ID } from '../config'

const APP_NAME = 'CoW Swap · WASM SDK'

// wagmi owns the connection lifecycle. EIP-6963 discovery (on by default) lists
// installed browser wallets (MetaMask, Rabby, …) by name with their own icons, so no
// explicit injected() connector is configured. WalletConnect and Coinbase are registered
// here as persistent connectors so their sessions auto-reconnect across reloads — which
// is essential on mobile: switching network sends the page to the wallet app and back,
// and an unregistered connector would be dropped on the return trip. The chain set
// matches the SDK's supported chains so the network switcher can reach any of them and
// the WalletConnect session is approved for every switchable chain. (WalletConnect's
// AppKit QR modal is code-split by the connector, so it still loads only when shown.)
const chains = [mainnet, gnosis, base, arbitrum, polygon, bsc, avalanche, linea, ink, plasma, sepolia] as const

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: APP_NAME,
        description: 'CoW Protocol Rust SDK compiled to WebAssembly',
        url: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
        icons: [],
      },
    }),
    coinbaseWallet({ appName: APP_NAME }),
  ],
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
