import { Modal } from '../../ui/Modal'
import type { SwapSettings } from './settings'

interface SwapSettingsProps {
  open: boolean
  onClose: () => void
  mode: 'market' | 'limit'
  settings: SwapSettings
  onChange: (next: SwapSettings) => void
  // The SDK's live suggestion for the current quote, shown under Auto (market only).
  suggestedSlippageBps?: number
}

export function SwapSettingsPanel({
  open,
  onClose,
  mode,
  settings,
  onChange,
  suggestedSlippageBps,
}: SwapSettingsProps) {
  const isLimit = mode === 'limit'
  const auto = settings.slippage.mode === 'auto'
  // Under Auto, mirror the SDK's suggestion; under manual, the user's own text.
  const slippageValue = auto
    ? suggestedSlippageBps !== undefined
      ? (suggestedSlippageBps / 100).toString()
      : ''
    : settings.slippage.percent

  return (
    <Modal open={open} onClose={onClose} title={isLimit ? 'Limit settings' : 'Swap settings'}>
      <div className="settings">
        {/* Limit prices are exact, so a slippage tolerance only applies to market swaps. */}
        {!isLimit ? (
          <section className="settings-group">
            <h4 className="settings-heading">MEV-protected slippage</h4>
            <div className="slippage-control">
              <button
                type="button"
                className={auto ? 'chip chip-active' : 'chip'}
                onClick={() => onChange({ ...settings, slippage: { ...settings.slippage, mode: 'auto' } })}
              >
                Auto
              </button>
              <div className="settings-input-wrap">
                <input
                  className="settings-input"
                  inputMode="decimal"
                  placeholder="0.50"
                  value={slippageValue}
                  onChange={(event) => {
                    const next = event.target.value.replace(/,/g, '.')
                    if (next === '' || /^\d*\.?\d*$/.test(next)) {
                      onChange({ ...settings, slippage: { mode: 'manual', percent: next } })
                    }
                  }}
                />
                <span className="settings-unit">%</span>
              </div>
            </div>
            <p className="settings-note">
              Orders settle in batch auctions, so your slippage can&apos;t be exploited by MEV. Auto
              follows the protocol&apos;s live suggestion for the current trade.
            </p>
          </section>
        ) : null}

        <section className="settings-group">
          <h4 className="settings-heading">{isLimit ? 'Order expiry' : 'Swap expiration'}</h4>
          <div className="settings-input-wrap">
            {isLimit ? (
              <input
                className="settings-input"
                inputMode="numeric"
                placeholder="7"
                value={settings.limitExpiryDays === 0 ? '' : String(settings.limitExpiryDays)}
                onChange={(event) => {
                  const next = event.target.value
                  if (/^\d*$/.test(next)) {
                    onChange({ ...settings, limitExpiryDays: next === '' ? 0 : Number(next) })
                  }
                }}
              />
            ) : (
              <input
                className="settings-input"
                inputMode="numeric"
                placeholder="30"
                value={settings.expiryMinutes === 0 ? '' : String(settings.expiryMinutes)}
                onChange={(event) => {
                  const next = event.target.value
                  if (/^\d*$/.test(next)) {
                    onChange({ ...settings, expiryMinutes: next === '' ? 0 : Number(next) })
                  }
                }}
              />
            )}
            <span className="settings-unit">{isLimit ? 'days' : 'minutes'}</span>
          </div>
          <p className="settings-note">
            {isLimit
              ? 'The limit order is cancelled if it has not filled within this period; CoW has no good-till-cancelled.'
              : 'The order will not execute if it stays pending past this duration.'}
          </p>
        </section>

        <section className="settings-group">
          <h4 className="settings-heading">{isLimit ? 'Limit interface' : 'Swap interface'}</h4>

          <div className="settings-row">
            <span>Custom recipient</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.recipient.enabled}
              className={`toggle${settings.recipient.enabled ? ' toggle-on' : ''}`}
              onClick={() =>
                onChange({
                  ...settings,
                  recipient: { ...settings.recipient, enabled: !settings.recipient.enabled },
                })
              }
            >
              <span className="toggle-knob" aria-hidden="true" />
            </button>
          </div>

          {isLimit ? (
            <div className="settings-row">
              <span>Allow partial fills</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.partialFills}
                className={`toggle${settings.partialFills ? ' toggle-on' : ''}`}
                onClick={() => onChange({ ...settings, partialFills: !settings.partialFills })}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <div className="settings-row">
            <span>Token approval</span>
            <div className="segmented" role="group" aria-label="Token approval amount">
              <button
                type="button"
                className={settings.approval === 'exact' ? 'seg seg-active' : 'seg'}
                onClick={() => onChange({ ...settings, approval: 'exact' })}
              >
                Exact
              </button>
              <button
                type="button"
                className={settings.approval === 'unlimited' ? 'seg seg-active' : 'seg'}
                onClick={() => onChange({ ...settings, approval: 'unlimited' })}
              >
                Unlimited
              </button>
            </div>
          </div>
          <p className="settings-note">
            {isLimit
              ? 'Partial fills let the order execute in pieces as liquidity allows; otherwise it is fill-or-kill. '
              : ''}
            Exact approves only what this order spends, re-approving each trade. Unlimited approves once
            for all future trades of this token.
          </p>
        </section>
      </div>
    </Modal>
  )
}
