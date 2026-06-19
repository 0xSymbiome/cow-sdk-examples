import { isAddress } from 'viem'

import { DEFAULT_EXPIRY_MINUTES, DEFAULT_SLIPPAGE_BPS } from '../../config'

// Every user-tunable swap setting in one object, so the settings panel, the swap
// card, and the review modal all read and write a single source of truth.
export interface SwapSettings {
  // `auto` reads the SDK's per-quote suggestion; `manual` uses an explicit percent.
  slippage: { mode: 'auto' | 'manual'; percent: string }
  // Order lifetime, in whole minutes.
  expiryMinutes: number
  // A custom receiver, off by default (the order pays the owner).
  recipient: { enabled: boolean; address: string }
  // Approve exactly what the order spends, or an unlimited one-time allowance.
  approval: 'exact' | 'unlimited'
}

export type ApprovalChoice = SwapSettings['approval']

export const DEFAULT_SETTINGS: SwapSettings = {
  slippage: { mode: 'auto', percent: (DEFAULT_SLIPPAGE_BPS / 100).toString() },
  expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  recipient: { enabled: false, address: '' },
  approval: 'exact',
}

// An unlimited ERC-20 allowance (2^256 - 1) for the "full approval" choice.
export const MAX_UINT256 = ((1n << 256n) - 1n).toString()

// Manual slippage in basis points, clamped to [0, 50%]. Returns `undefined` under
// Auto — omitting the field tells the SDK to apply (and report) its own suggestion.
export function manualSlippageBps(settings: SwapSettings): number | undefined {
  if (settings.slippage.mode !== 'manual') return undefined
  const percent = Number.parseFloat(settings.slippage.percent)
  if (!Number.isFinite(percent) || percent < 0) return 0
  return Math.min(5_000, Math.round(percent * 100))
}

// Order lifetime in seconds, clamped to the protocol's UI bounds (1 minute … 3 hours).
export function validForSeconds(settings: SwapSettings): number {
  const minutes = Number.isFinite(settings.expiryMinutes) ? settings.expiryMinutes : 0
  return Math.min(10_800, Math.max(60, Math.round(minutes) * 60))
}

// The receiver to put on the order: the trimmed address when the toggle is on and
// it parses; otherwise `undefined`, which lets the SDK default the receiver to the owner.
export function resolvedReceiver(settings: SwapSettings): string | undefined {
  if (!settings.recipient.enabled) return undefined
  const address = settings.recipient.address.trim()
  return isAddress(address) ? address : undefined
}

// True when a custom recipient is requested but the address is not yet valid — used
// to hold the review button until the user supplies a usable address.
export function recipientPending(settings: SwapSettings): boolean {
  return settings.recipient.enabled && resolvedReceiver(settings) === undefined
}
