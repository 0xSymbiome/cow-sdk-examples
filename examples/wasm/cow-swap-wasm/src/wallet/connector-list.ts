import type { Connector } from 'wagmi'

// One entry in the wallet picker. `onSelect` either connects a discovered injected
// wallet or triggers the on-demand WalletConnect / Coinbase connect.
export interface WalletOption {
  id: string
  name: string
  icon?: string
  onSelect: () => void
}

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`

const WALLETCONNECT_ICON = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#3396FF"/><path fill="#fff" d="M13 16.4a10 10 0 0 1 14 0l.5.5a.5.5 0 0 1 0 .7l-1.6 1.6a.3.3 0 0 1-.4 0l-.7-.6a7 7 0 0 0-9.6 0l-.7.7a.3.3 0 0 1-.4 0L12.5 18a.5.5 0 0 1 0-.7l.5-.9Zm17.3 3.2 1.4 1.4a.5.5 0 0 1 0 .7l-6.4 6.3a.5.5 0 0 1-.7 0l-4.5-4.5a.1.1 0 0 0-.2 0L15.4 28a.5.5 0 0 1-.7 0l-6.5-6.3a.5.5 0 0 1 0-.7l1.5-1.4a.5.5 0 0 1 .7 0l4.5 4.5a.1.1 0 0 0 .2 0l4.4-4.5a.5.5 0 0 1 .7 0l4.5 4.5a.1.1 0 0 0 .2 0l4.4-4.5a.5.5 0 0 1 .8 0Z"/></svg>',
)

const COINBASE_ICON = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0052FF"/><circle cx="20" cy="20" r="13" fill="#fff"/><rect x="16" y="16" width="8" height="8" rx="1.5" fill="#0052FF"/></svg>',
)

/**
 * The wallet-picker entries: EIP-6963-discovered browser wallets first (each with its
 * announced icon), then WalletConnect and Coinbase, whose SDKs load on demand. The
 * Coinbase extension announces itself over EIP-6963, so when it is already discovered
 * the on-demand Coinbase entry is dropped to avoid listing it twice.
 */
export function walletOptions(
  connectors: readonly Connector[],
  onInjected: (connector: Connector) => void,
  onWalletConnect: () => void,
  onCoinbase: () => void,
): WalletOption[] {
  const injected = connectors.filter((connector) => connector.type === 'injected')
  const options: WalletOption[] = injected.map((connector) => ({
    id: connector.uid,
    name: connector.name,
    icon: connector.icon,
    onSelect: () => onInjected(connector),
  }))

  options.push({ id: 'walletConnect', name: 'WalletConnect', icon: WALLETCONNECT_ICON, onSelect: onWalletConnect })
  if (!injected.some((connector) => connector.name.toLowerCase().includes('coinbase'))) {
    options.push({ id: 'coinbaseWallet', name: 'Coinbase Wallet', icon: COINBASE_ICON, onSelect: onCoinbase })
  }
  return options
}
