import { useMemo, useState } from 'react'
import { isAddress, type PublicClient } from 'viem'

import { formatAmount } from '../../lib/format'
import { importToken, useBalances, type TokenInfo } from '../../tokens/tokens'
import { Modal } from '../../ui/Modal'
import { Spinner } from '../../ui/primitives'
import { TokenLogo } from '../../ui/TokenLogo'
import { useWallet } from '../../wallet/WalletProvider'

interface TokenSelectProps {
  open: boolean
  onClose: () => void
  tokens: TokenInfo[]
  onSelect: (token: TokenInfo) => void
  excludeAddress?: string
}

function matches(token: TokenInfo, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    token.symbol.toLowerCase().includes(needle) ||
    token.name.toLowerCase().includes(needle) ||
    token.address.toLowerCase() === needle
  )
}

export function TokenSelect({ open, onClose, tokens, onSelect, excludeAddress }: TokenSelectProps) {
  const { publicClient, chainId } = useWallet()
  const [query, setQuery] = useState('')
  const [imported, setImported] = useState<TokenInfo[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string>()

  const all = useMemo(() => [...imported, ...tokens], [imported, tokens])
  const filtered = useMemo(() => all.filter((token) => matches(token, query)), [all, query])

  // Balances are fetched for the highest-priority tokens (the curated head of
  // the merged list), so the query key stays stable across keystrokes.
  const balanceTokens = useMemo(() => all.slice(0, 30), [all])
  const balances = useBalances(balanceTokens)

  const canImport =
    filtered.length === 0 && isAddress(query.trim()) && publicClient !== undefined && chainId !== undefined

  async function handleImport() {
    if (!publicClient || chainId === undefined) return
    setImporting(true)
    setImportError(undefined)
    try {
      const token = await importToken(publicClient as PublicClient, chainId, query.trim())
      setImported((current) => [token, ...current])
      setQuery('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import token')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Select a token">
      <input
        className="token-search"
        placeholder="Search name or paste address"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />

      <ul className="token-list">
        {filtered.map((token) => {
          const disabled = token.address === excludeAddress
          const balance = balances.data?.[token.address]
          return (
            <li key={token.address}>
              <button
                type="button"
                className="token-row"
                disabled={disabled}
                onClick={() => {
                  onSelect(token)
                  onClose()
                }}
              >
                <TokenLogo token={token} />
                <span className="token-row-text">
                  <strong>{token.symbol}</strong>
                  <small>{token.name}</small>
                </span>
                <span className="token-row-balance">
                  {balance ? formatAmount(balance, token.decimals, 4) : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {canImport ? (
        <div className="token-import">
          <p>No token in your lists matches this address.</p>
          <button type="button" className="btn btn-secondary" onClick={handleImport} disabled={importing}>
            {importing ? <Spinner small /> : null}
            Import this token
          </button>
          {importError ? <p className="error-text">{importError}</p> : null}
        </div>
      ) : null}
    </Modal>
  )
}
