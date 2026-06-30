import { useEffect, useRef, useState } from 'react'

import { chainMeta, explorerAddressUrl, supportedChains } from '../../chains/registry'
import { Cow } from '../../ui/Cow'
import { Button } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/toast'
import { connectorIcon, orderConnectors } from '../../wallet/connector-list'
import { useWallet } from '../../wallet/WalletProvider'

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function Header() {
  const { account, chainId, connectors, connect, disconnect, switchChain, walletName, connecting } =
    useWallet()
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const chains = supportedChains()
  const knownChain = chainId !== undefined && chainMeta(chainId) !== undefined
  const walletOptions = orderConnectors(connectors)

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
          <Select
            value={knownChain ? String(chainId) : ''}
            options={chains.map((meta) => ({
              value: String(meta.chain.id),
              label: `${meta.label}${meta.testnet ? ' (testnet)' : ''}`,
            }))}
            onChange={(value) => {
              const target = Number(value)
              void switchChain(target).catch((error: unknown) => {
                if ((error as { code?: number }).code === 4001) return // user rejected the switch
                const label = chainMeta(target)?.label ?? 'the selected network'
                toast.push({
                  tone: 'info',
                  title: 'Switch network in your wallet',
                  detail: `Couldn't switch from the page — change to ${label} in your wallet. Some mobile wallets don't sync the switch back.`,
                })
              })
            }}
            ariaLabel="Network"
            placeholder="Unsupported network"
            triggerClassName="chain-select"
          />
        ) : null}

        {account === undefined ? (
          connecting ? (
            // A reconnect (e.g. resuming a WalletConnect session after a mobile network
            // switch) is in flight — show progress rather than a disconnected CTA.
            <Button loading disabled>
              Connecting…
            </Button>
          ) : (
            <Button onClick={() => setPicking(true)}>Connect wallet</Button>
          )
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
        <p className="muted">
          Pick a wallet below. TWAP orders need a Safe (smart-contract wallet) — connect one through
          WalletConnect.
        </p>
        <ul className="wallet-list">
          {walletOptions.map((target) => {
            const icon = connectorIcon(target)
            return (
              <li key={target.uid}>
                <button
                  type="button"
                  onClick={() => {
                    connect(target)
                    setPicking(false)
                  }}
                >
                  {icon ? <img src={icon} width={24} height={24} alt="" /> : null}
                  {target.name}
                </button>
              </li>
            )
          })}
        </ul>
      </Modal>
    </header>
  )
}
