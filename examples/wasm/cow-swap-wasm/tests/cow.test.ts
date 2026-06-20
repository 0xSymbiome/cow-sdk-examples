import { describe, expect, it } from 'vitest'

import { CowError } from '@symbiome-forge/cow-sdk-wasm/trading'

import { toCowJsonValue } from '../src/lib/cow-callbacks'
import { orderbookAction, toUiError } from '../src/lib/cow-errors'
import { formatAmount, fromAtoms, isPositiveAmount, toAtoms } from '../src/lib/format'

describe('toCowJsonValue (ContractReadCallback shape)', () => {
  it('serializes a uint as a decimal string, matching the Rust reference decoder', () => {
    // ERC-20 allowance reads return a single uint256 → JSON string of the decimal.
    expect(JSON.stringify(toCowJsonValue(123456789n))).toBe('"123456789"')
  })

  it('lowercases addresses and preserves booleans', () => {
    expect(toCowJsonValue('0xAbCdEf0000000000000000000000000000000001')).toBe(
      '0xabcdef0000000000000000000000000000000001',
    )
    expect(toCowJsonValue(true)).toBe(true)
  })

  it('recurses into tuples and arrays, converting each element', () => {
    expect(toCowJsonValue([7n, true, '0xAA'])).toStrictEqual(['7', true, '0xaa'])
  })
})

describe('amount formatting', () => {
  it('round-trips human <-> base units', () => {
    expect(toAtoms('1.5', 6)).toBe('1500000')
    expect(fromAtoms('1500000', 6)).toBe('1.5')
  })

  it('trims trailing zeros for display', () => {
    expect(formatAmount('1500000', 6)).toBe('1.5')
    expect(formatAmount('1000000', 6)).toBe('1')
  })

  it('validates positive amounts', () => {
    expect(isPositiveAmount('0.1', 18)).toBe(true)
    expect(isPositiveAmount('0', 18)).toBe(false)
    expect(isPositiveAmount('', 18)).toBe(false)
    expect(isPositiveAmount('abc', 18)).toBe(false)
  })
})

describe('toUiError', () => {
  it('treats a user-declined signature as a soft rejection', () => {
    const ui = toUiError(
      new CowError({ kind: 'walletRequest', method: 'eth_signTypedData_v4', code: 4001, message: 'User rejected' }),
    )
    expect(ui.userRejected).toBe(true)
    expect(ui.title).toBe('Signature declined')
  })

  it('surfaces the orderbook retry verdict the SDK computed', () => {
    const ui = toUiError(
      new CowError({ kind: 'orderbook', category: 'insufficientFunds', message: 'not enough balance', retryable: false }),
    )
    expect(ui.title).toBe('Insufficient balance')
    expect(ui.retryable).toBe(false)
  })

  it('refines an allowance rejection past the coarse funds category via errorType', () => {
    const ui = toUiError(
      new CowError({
        kind: 'orderbook',
        category: 'insufficientFunds',
        errorType: 'InsufficientAllowance',
        message: 'token approval required',
        retryable: false,
      }),
    )
    expect(ui.title).toBe('Token approval needed')
    expect(ui.action).toBe('approve')
  })

  it('wraps non-SDK errors safely', () => {
    expect(toUiError(new Error('boom')).title).toBe('Unexpected error')
  })
})

describe('orderbookAction (errorType → recovery)', () => {
  it('maps the services errorType tags onto a concrete next step', () => {
    expect(orderbookAction('InsufficientAllowance')).toBe('approve')
    expect(orderbookAction('InsufficientBalance')).toBe('fund')
    expect(orderbookAction('QuoteNotFound')).toBe('requote')
    expect(orderbookAction('UnsupportedToken')).toBeUndefined()
    expect(orderbookAction(undefined)).toBeUndefined()
  })
})
