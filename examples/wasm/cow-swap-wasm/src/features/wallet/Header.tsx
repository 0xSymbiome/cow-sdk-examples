import { useEffect, useRef, useState } from 'react'

import { chainMeta, explorerAddressUrl, supportedChains } from '../../chains/registry'
import { Cow } from '../../ui/Cow'
import { Button } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/toast'
import { useWallet } from '../../wallet/WalletProvider'

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function Header() {
  const { account, chainId, providers, connect, disconnect, switchChain, walletName, connecting } =
    useWallet()
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const chains = supportedChains()
  const knownChain = chainId !== undefined && chainMeta(chainId) !== undefined
  // Phone browsers have no injected provider; a wallet's in-app browser does.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function copyAddress() {
    if (account === undefined) return
    try {
      await navigator.clipboard.writeText(account)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — ignore.
    }
  }

  return (
    <header className="app-header">
      <div className="brand">
        <Cow size={32} className="brand-cow" />
        <div>
          <strong>CoW Swap</strong>
          <small>
            <a
              className="src-link"
              href="https://github.com/0xSymbiome/cow-rs"
              target="_blank"
              rel="noreferrer"
            >
              Rust SDK
            </a>
            {' · WebAssembly'}
          </small>
        </div>
      </div>

      <div className="header-actions">
        {account !== undefined ? (
          <select
            className="chain-select"
            value={knownChain ? chainId : ''}
            onChange={(event) => {
              void switchChain(Number(event.target.value)).catch((error: unknown) => {
                if ((error as { code?: number }).code === 4001) return
                toast.push({
                  tone: 'danger',
                  title: 'Could not switch network',
                  detail: 'Your wallet declined or failed the network switch.',
                })
              })
            }}
          >
            {!knownChain ? <option value="">Unsupported network</option> : null}
            {chains.map((meta) => (
              <option key={meta.chain.id} value={meta.chain.id}>
                {meta.label}
                {meta.testnet ? ' (testnet)' : ''}
              </option>
            ))}
          </select>
        ) : null}

        {account === undefined ? (
          <Button onClick={() => setPicking(true)} loading={connecting}>
            Connect wallet
          </Button>
        ) : (
          <div className="account" ref={menuRef}>
            <button
              type="button"
              className="account-pill"
              onClick={() => setMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="account-dot" aria-hidden="true" />
              <span className="account-addr">{short(account)}</span>
              <span className="chevron">▾</span>
            </button>
            {menuOpen ? (
              <div className="account-menu" role="menu">
                <div className="account-menu-head">
                  <span className="account-menu-wallet">{walletName}</span>
                  <span className="account-menu-addr">{account}</span>
                </div>
                <button type="button" role="menuitem" onClick={copyAddress}>
                  {copied ? 'Copied ✓' : 'Copy address'}
                </button>
                {knownChain && chainId !== undefined ? (
                  <a
                    role="menuitem"
                    href={explorerAddressUrl(chainId, account)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenuOpen(false)}
                  >
                    View on explorer ↗
                  </a>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu-disconnect"
                  onClick={() => {
                    disconnect()
                    setMenuOpen(false)
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title="Connect a wallet">
        {providers.length === 0 ? (
          <div className="empty-guide">
            <Cow mood="happy" size={56} />
            {isMobile ? (
            <div>
              <p className="muted">Open this page inside your wallet app&apos;s browser to connect:</p>
              <ul className="wallet-list">
                <li>
                  <a href={`https://link.metamask.io/dapp/${window.location.host}${window.location.pathname}`}>
                    Open in MetaMask
                  </a>
                </li>
                <li>
                  <a href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(window.location.href)}`}>
                    Open in Coinbase Wallet
                  </a>
                </li>
              </ul>
              <p className="muted">Or paste this page&apos;s URL into any wallet&apos;s in-app browser.</p>
            </div>
          ) : (
            <p className="muted">
              No injected wallet found. Install MetaMask, Rabby, Frame, or another EIP-6963 wallet and
              reload.
            </p>
            )}
          </div>
        ) : (
          <ul className="wallet-list">
            {providers.map((detail) => (
              <li key={detail.info.uuid}>
                <button
                  type="button"
                  onClick={async () => {
                    await connect(detail)
                    setPicking(false)
                  }}
                >
                  <img src={detail.info.icon} width={24} height={24} alt="" />
                  {detail.info.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </header>
  )
}
