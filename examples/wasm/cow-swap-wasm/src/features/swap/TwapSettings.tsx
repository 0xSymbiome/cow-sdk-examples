import { Modal } from '../../ui/Modal'
import type { SwapSettings } from './settings'

interface TwapSettingsProps {
  open: boolean
  onClose: () => void
  settings: SwapSettings
  onChange: (next: SwapSettings) => void
}

// The TWAP settings popover. Only Custom Recipient is exposed here (slippage is
// the inline price protection and the lifetime is the duration), so the toggle
// drives the shared `settings.recipient`; the address field lives in the panel body.
export function TwapSettingsPanel({ open, onClose, settings, onChange }: TwapSettingsProps) {
  return (
    <Modal open={open} onClose={onClose} title="TWAP settings">
      <div className="settings">
        <section className="settings-group">
          <h4 className="settings-heading">TWAP interface</h4>
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
                  recipient: {
                    enabled: !settings.recipient.enabled,
                    address: settings.recipient.enabled ? '' : settings.recipient.address,
                  },
                })
              }
            >
              <span className="toggle-knob" aria-hidden="true" />
            </button>
          </div>
          <p className="settings-note">
            Send the bought tokens to an address other than your Safe. Each part pays this recipient.
          </p>
        </section>
      </div>
    </Modal>
  )
}
