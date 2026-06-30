import { createContext, use, useCallback, type ReactNode } from 'react'
import type { Address, PublicClient, WalletClient } from 'viem'
import {
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
  type Connector,
} from 'wagmi'

import { wagmiConfig } from './wagmi'

type SupportedChainId = (typeof wagmiConfig.chains)[number]['id']

interface WalletContextValue {
  account?: Address
  chainId?: number
  walletName?: string
  walletClient?: WalletClient
  publicClient?: PublicClient
  connecting: boolean
  connectors: readonly Connector[]
  connect: (connector: Connector) => void
  disconnect: () => void
  switchChain: (chainId: number) => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

// The provider is a thin bridge over wagmi: wagmi handles EIP-6963 discovery,
// connection, WalletConnect/Coinbase sessions, reconnection, and chain switching. This
// exposes the `useWallet()` shape the rest of the app already consumes.
export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <WalletBridge>{children}</WalletBridge>
    </WagmiProvider>
  )
}

function WalletBridge({ children }: { children: ReactNode }) {
  const { address, chainId, connector, status } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()

  const connectWith = useCallback((target: Connector) => connect({ connector: target }), [connect])
  const switchChain = useCallback(
    async (target: number) => {
      await switchChainAsync({ chainId: target as SupportedChainId })
    },
    [switchChainAsync],
  )

  const value: WalletContextValue = {
    account: address,
    chainId,
    walletName: connector?.name,
    walletClient: (walletClient ?? undefined) as WalletClient | undefined,
    publicClient: (publicClient ?? undefined) as PublicClient | undefined,
    connecting: status === 'connecting' || status === 'reconnecting' || isPending,
    connectors,
    connect: connectWith,
    disconnect: () => disconnect(),
    switchChain,
  }

  return <WalletContext value={value}>{children}</WalletContext>
}

export function useWallet(): WalletContextValue {
  const ctx = use(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
