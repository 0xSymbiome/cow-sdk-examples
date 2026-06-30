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

// wagmi's WalletConnect connector registers every configured chain as an *optional*
// namespace, so the wallet decides which it actually approves at pairing time — usually
// just the chain it is currently on. WalletConnect's EthereumProvider only switches
// locally (`setDefaultChain`, no relay traffic) for a chain that is in the approved
// session; for any *other* chain it sends a `wallet_switchEthereumChain` request over the
// relay. On mobile that request deep-links to the wallet, and a wallet asked to switch to
// a chain it never approved commonly answers with `wc_sessionDelete` — which tears the
// whole session down (the provider emits `disconnect`, wagmi removes the connection and
// persists an empty store), leaving nothing to reconnect to. Reading the session's
// approved chains lets us take the safe local path when possible and avoid the
// session-killing request otherwise.
const WALLETCONNECT_CONNECTOR_ID = 'walletConnect'

interface WalletConnectSessionProvider {
  session?: { namespaces?: Record<string, { accounts?: readonly string[] } | undefined> }
}

// The CAIP-2 chain ids the active WalletConnect session was actually approved for, parsed
// from `eip155:<chainId>:<address>` account entries. Returns undefined when the connector
// is not WalletConnect or has no live session, so callers can fall back to a plain switch.
async function approvedWalletConnectChains(connector: Connector): Promise<Set<number> | undefined> {
  if (connector.id !== WALLETCONNECT_CONNECTOR_ID) return undefined
  let provider: WalletConnectSessionProvider
  try {
    provider = (await connector.getProvider()) as WalletConnectSessionProvider
  } catch {
    return undefined
  }
  const accounts = provider.session?.namespaces?.eip155?.accounts
  if (!accounts) return undefined
  const approved = new Set<number>()
  for (const account of accounts) {
    const chainId = Number.parseInt(account.split(':')[1] ?? '', 10)
    if (Number.isFinite(chainId)) approved.add(chainId)
  }
  return approved
}

// Thrown when a WalletConnect session has not approved the target chain. The switch never
// reaches the wallet (it would risk a session-killing relay request), so this is surfaced
// to guide the user to switch in-wallet rather than treated as a wallet-side rejection.
export class WalletConnectChainNotApprovedError extends Error {
  readonly chainNotApprovedInSession = true
  constructor(chainId: number) {
    super(`WalletConnect session has not approved chain ${chainId}`)
    this.name = 'WalletConnectChainNotApprovedError'
  }
}

export function isWalletConnectChainNotApprovedError(error: unknown): error is WalletConnectChainNotApprovedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { chainNotApprovedInSession?: boolean }).chainNotApprovedInSession === true
  )
}

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
      // For a WalletConnect connection, only switch to a chain the live session already
      // approved — that path is purely local in the provider and survives the mobile
      // round-trip. Switching to an unapproved chain would send a relay request that many
      // wallets answer by deleting the session, so we refuse it (the Header then guides the
      // user to switch in-wallet) instead of destroying the connection. EOA/injected and
      // Coinbase connections are unaffected and still switch directly.
      if (connector) {
        const approved = await approvedWalletConnectChains(connector)
        if (approved && !approved.has(target)) throw new WalletConnectChainNotApprovedError(target)
      }
      await switchChainAsync({ chainId: target as SupportedChainId })
    },
    [connector, switchChainAsync],
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
