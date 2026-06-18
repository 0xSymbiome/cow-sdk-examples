// EIP-6963 multi-injected-provider discovery. Browsers announce each injected
// wallet (MetaMask, Rabby, Frame, …) on request; this collects the announcements
// so the UI can list the available wallets.

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: string, listener: (...args: never[]) => void): void
  removeListener?(event: string, listener: (...args: never[]) => void): void
}

export interface Eip6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

interface AnnounceEvent extends CustomEvent {
  detail: Eip6963ProviderDetail
}

/**
 * Subscribe to provider announcements and request a fresh round. Returns an
 * unsubscribe function. De-duplicates by `rdns`.
 */
export function discoverProviders(
  onChange: (providers: Eip6963ProviderDetail[]) => void,
): () => void {
  const byRdns = new Map<string, Eip6963ProviderDetail>()

  const handler = (event: Event): void => {
    const { detail } = event as AnnounceEvent
    if (detail?.info?.rdns) {
      byRdns.set(detail.info.rdns, detail)
      onChange([...byRdns.values()])
    }
  }

  window.addEventListener('eip6963:announceProvider', handler)
  window.dispatchEvent(new Event('eip6963:requestProvider'))

  return () => window.removeEventListener('eip6963:announceProvider', handler)
}
