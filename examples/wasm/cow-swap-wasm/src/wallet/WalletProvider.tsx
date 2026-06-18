import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  numberToHex,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'

import { chainMeta } from '../chains/registry'
import { disposeAll } from '../lib/cow'
import { discoverProviders, type Eip6963ProviderDetail } from './eip6963'

interface WalletContextValue {
  providers: Eip6963ProviderDetail[]
  account?: Address
  chainId?: number
  walletName?: string
  walletClient?: WalletClient
  publicClient?: PublicClient
  connecting: boolean
  connect: (detail: Eip6963ProviderDetail) => Promise<void>
  disconnect: () => void
  switchChain: (chainId: number) => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

// Remember the last connected wallet so the session can be restored silently on
// reload (via `eth_accounts`, which never prompts).
const LAST_WALLET_KEY = 'cow-swap-wasm:last-wallet-rdns'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([])
  const [active, setActive] = useState<Eip6963ProviderDetail>()
  const [account, setAccount] = useState<Address>()
  const [chainId, setChainId] = useState<number>()
  const [connecting, setConnecting] = useState(false)

  useEffect(() => discoverProviders(setProviders), [])

  const provider = active?.provider

  // viem clients are rebuilt whenever the provider, account, or chain changes.
  // The public client serves reads (allowance, balances) and the wallet client
  // serves signing and tx submission — both over the injected provider.
  const { walletClient, publicClient } = useMemo(() => {
    if (!provider) return { walletClient: undefined, publicClient: undefined }
    const chain = chainId ? chainMeta(chainId)?.chain : undefined
    const transport = custom(provider as unknown as Parameters<typeof custom>[0])
    return {
      walletClient: createWalletClient({ account, chain, transport }),
      publicClient: createPublicClient({ chain, transport }),
    }
  }, [provider, account, chainId])

  // Reflect wallet-driven account/network changes back into UI state.
  useEffect(() => {
    if (!provider?.on) return
    const onAccounts = (accounts: string[]) => {
      const next = accounts[0] as Address | undefined
      setAccount(next)
      if (!next) localStorage.removeItem(LAST_WALLET_KEY)
    }
    const onChain = (hexChainId: string) => setChainId(Number(BigInt(hexChainId)))
    provider.on('accountsChanged', onAccounts as never)
    provider.on('chainChanged', onChain as never)
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts as never)
      provider.removeListener?.('chainChanged', onChain as never)
    }
  }, [provider])

  // Restore the previous session on reload: if the last-used wallet is present
  // and still has authorized accounts, re-attach silently (eth_accounts never
  // prompts).
  useEffect(() => {
    if (active || providers.length === 0) return
    const rdns = localStorage.getItem(LAST_WALLET_KEY)
    if (!rdns) return
    const detail = providers.find((entry) => entry.info.rdns === rdns)
    if (!detail) return
    let cancelled = false
    void (async () => {
      try {
        const accounts = (await detail.provider.request({ method: 'eth_accounts' })) as string[]
        if (cancelled || accounts.length === 0) return
        const hexChainId = (await detail.provider.request({ method: 'eth_chainId' })) as string
        setActive(detail)
        setAccount(accounts[0] as Address | undefined)
        setChainId(Number(BigInt(hexChainId)))
      } catch {
        // Ignore — the user can reconnect manually.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [providers, active])

  // Release the wasm-held SDK clients when the active chain changes or the app
  // unmounts. Each client owns a fetch-callback registry guard freed on dispose;
  // the cleanup runs on chain change (before the next chain's clients are built)
  // and on teardown.
  useEffect(() => () => disposeAll(), [chainId])

  const connect = useCallback(async (detail: Eip6963ProviderDetail) => {
    setConnecting(true)
    try {
      const accounts = (await detail.provider.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const hexChainId = (await detail.provider.request({ method: 'eth_chainId' })) as string
      setActive(detail)
      setAccount(accounts[0] as Address | undefined)
      setChainId(Number(BigInt(hexChainId)))
      localStorage.setItem(LAST_WALLET_KEY, detail.info.rdns)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setActive(undefined)
    setAccount(undefined)
    setChainId(undefined)
    localStorage.removeItem(LAST_WALLET_KEY)
  }, [])

  const switchChain = useCallback(
    async (target: number) => {
      if (!provider) return
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(target) }],
        })
        setChainId(target)
      } catch (error) {
        // 4902: the chain isn't in the wallet yet — offer to add it, then select.
        if ((error as { code?: number }).code === 4902) {
          const meta = chainMeta(target)
          if (!meta) throw error
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: numberToHex(target),
                chainName: meta.chain.name,
                nativeCurrency: meta.chain.nativeCurrency,
                rpcUrls: [...meta.chain.rpcUrls.default.http],
                blockExplorerUrls: [meta.explorerBase],
              },
            ],
          })
          setChainId(target)
          return
        }
        // 4001 (user rejected) or anything else: let the caller surface it.
        throw error
      }
    },
    [provider],
  )

  const value: WalletContextValue = {
    providers,
    account,
    chainId,
    walletName: active?.info.name,
    walletClient,
    publicClient,
    connecting,
    connect,
    disconnect,
    switchChain,
  }

  return <WalletContext value={value}>{children}</WalletContext>
}

export function useWallet(): WalletContextValue {
  const ctx = use(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
