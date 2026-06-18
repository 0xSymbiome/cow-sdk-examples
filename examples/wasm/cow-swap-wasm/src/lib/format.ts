import { formatUnits, parseUnits } from 'viem'

// Token amounts cross the SDK boundary as base-unit decimal strings ("atoms").
// These helpers convert to and from human-readable values; viem owns the math.

/** Parse a human amount ("1.5") into base units for the given token decimals. */
export function toAtoms(amount: string, decimals: number): string {
  return parseUnits(amount as `${number}`, decimals).toString()
}

/** Format base units back to a full-precision decimal string. */
export function fromAtoms(atoms: string | bigint, decimals: number): string {
  return formatUnits(BigInt(atoms), decimals)
}

/** Format base units for display, trimmed to a sensible number of fraction digits. */
export function formatAmount(
  atoms: string | bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const full = formatUnits(BigInt(atoms), decimals)
  const [whole, fraction] = full.split('.')
  if (!fraction) return whole ?? '0'
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : (whole ?? '0')
}

/** True when the string parses to a positive amount. */
export function isPositiveAmount(amount: string, decimals: number): boolean {
  try {
    return parseUnits(amount as `${number}`, decimals) > 0n
  } catch {
    return false
  }
}

/** A compact USD-style display for a numeric value, e.g. "$1,234.56". */
export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}
