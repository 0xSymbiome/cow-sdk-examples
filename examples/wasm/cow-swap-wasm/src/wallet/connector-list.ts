import type { Connector } from 'wagmi'

// EIP-6963 discovery gives installed browser wallets (MetaMask, Rabby, …) their own
// icon; the configured WalletConnect and Coinbase connectors carry none, so fill those
// two in by brand.
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`

const WALLETCONNECT_ICON = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#3396FF"/><path fill="#fff" d="M13 16.4a10 10 0 0 1 14 0l.5.5a.5.5 0 0 1 0 .7l-1.6 1.6a.3.3 0 0 1-.4 0l-.7-.6a7 7 0 0 0-9.6 0l-.7.7a.3.3 0 0 1-.4 0L12.5 18a.5.5 0 0 1 0-.7l.5-.9Zm17.3 3.2 1.4 1.4a.5.5 0 0 1 0 .7l-6.4 6.3a.5.5 0 0 1-.7 0l-4.5-4.5a.1.1 0 0 0-.2 0L15.4 28a.5.5 0 0 1-.7 0l-6.5-6.3a.5.5 0 0 1 0-.7l1.5-1.4a.5.5 0 0 1 .7 0l4.5 4.5a.1.1 0 0 0 .2 0l4.4-4.5a.5.5 0 0 1 .7 0l4.5 4.5a.1.1 0 0 0 .2 0l4.4-4.5a.5.5 0 0 1 .8 0Z"/></svg>',
)

const COINBASE_ICON = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0052FF"/><circle cx="20" cy="20" r="13" fill="#fff"/><rect x="16" y="16" width="8" height="8" rx="1.5" fill="#0052FF"/></svg>',
)

/** The wallet's own icon, or a brand fallback for WalletConnect / Coinbase. */
export function connectorIcon(connector: Connector): string | undefined {
  if (connector.icon) return connector.icon
  const key = `${connector.id} ${connector.name}`.toLowerCase()
  if (key.includes('walletconnect')) return WALLETCONNECT_ICON
  if (key.includes('coinbase')) return COINBASE_ICON
  return undefined
}

/**
 * Discovered browser wallets first, then WalletConnect / Coinbase. Drops a configured
 * connector a discovered wallet already covers by name — the Coinbase extension, for
 * one, announces itself over EIP-6963 and would otherwise show twice.
 */
export function orderConnectors(connectors: readonly Connector[]): Connector[] {
  const browser = connectors.filter((connector) => connector.type === 'injected')
  const rest = connectors.filter((connector) => connector.type !== 'injected')
  const seen = new Set<string>()
  return [...browser, ...rest].filter((connector) => {
    const name = connector.name.toLowerCase()
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
}
