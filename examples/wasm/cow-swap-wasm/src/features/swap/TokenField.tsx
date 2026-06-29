import { formatAmount } from '../../lib/format'
import { TokenLogo } from '../../ui/TokenLogo'
import type { TokenInfo } from '../../tokens/tokens'

export interface TokenFieldProps {
  label: string
  token: TokenInfo | undefined
  amount: string
  editable: boolean
  loading?: boolean
  balanceAtoms?: string
  onAmount: (value: string) => void
  onPick: () => void
  onMax?: () => void
}

// A token amount input with the token picker and (when a balance is known) a
// balance line and Max button. Shared by the Swap, Limit, and TWAP panels.
export function TokenField({
  label,
  token,
  amount,
  editable,
  loading,
  balanceAtoms,
  onAmount,
  onPick,
  onMax,
}: TokenFieldProps) {
  return (
    <div className="token-field">
      <span className="token-field-label">{label}</span>
      <div className="token-field-row">
        {/* No real token amount needs this many characters; the cap stops pathological input. */}
        <input
          className={`amount-input${amount.length > 18 ? ' amount-xs' : amount.length > 11 ? ' amount-sm' : ''}`}
          inputMode="decimal"
          maxLength={30}
          placeholder={loading ? '…' : '0.0'}
          value={amount}
          readOnly={!editable}
          onChange={(event) => {
            // Some mobile keypads emit the locale decimal separator (a comma); store a dot.
            const next = event.target.value.replace(/,/g, '.')
            if (next === '' || /^\d*\.?\d*$/.test(next)) onAmount(next)
          }}
        />
        <button type="button" className="token-pick" onClick={onPick}>
          {token ? (
            <>
              <TokenLogo token={token} size={22} />
              <span>{token.symbol}</span>
            </>
          ) : (
            <span>Select</span>
          )}
          <span className="chevron">▾</span>
        </button>
      </div>
      {token && balanceAtoms !== undefined ? (
        <div className="token-field-meta">
          <span className="balance">
            Balance: {formatAmount(balanceAtoms, token.decimals, 4)} {token.symbol}
          </span>
          {onMax ? (
            <button type="button" className="max-btn" onClick={onMax}>
              Max
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
