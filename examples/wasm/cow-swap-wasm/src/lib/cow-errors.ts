import type { CowError } from '@symbiome-forge/cow-sdk-wasm/trading'

// The SDK throws a normalized, discriminated `CowError` (a plain object, not an
// `Error`). This maps each variant to a presentational shape the UI can render.

export interface UiError {
  title: string
  detail: string
  kind: string
  retryable: boolean
  retryAfterMs?: number
  /** A user-initiated rejection (declined signature) — shown softly, not as a failure. */
  userRejected: boolean
}

export function isCowError(value: unknown): value is CowError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'schemaVersion' in value
  )
}

export function toUiError(error: unknown): UiError {
  if (!isCowError(error)) {
    return {
      title: 'Unexpected error',
      detail: error instanceof Error ? error.message : String(error),
      kind: 'unknown',
      retryable: false,
      userRejected: false,
    }
  }

  switch (error.kind) {
    case 'walletRequest': {
      const declined = error.code === 4001
      return {
        title: declined ? 'Signature declined' : 'Wallet request failed',
        detail: error.message,
        kind: error.kind,
        retryable: !declined,
        userRejected: declined,
      }
    }
    case 'walletTimeout':
      return {
        title: 'Wallet timed out',
        detail: `No wallet response within ${Math.round(error.timeoutMs / 1000)}s.`,
        kind: error.kind,
        retryable: true,
        userRejected: false,
      }
    case 'unsupportedChain':
      return {
        title: 'Unsupported network',
        detail: `Chain ${error.chainId} is not supported. Switch to a supported network.`,
        kind: error.kind,
        retryable: false,
        userRejected: false,
      }
    case 'orderbook':
      return {
        title: orderbookTitle(error.category),
        detail: error.message,
        kind: error.kind,
        retryable: error.retryable,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        userRejected: false,
      }
    case 'invalidInput':
      return {
        title: 'Invalid input',
        detail: error.field ? `${error.field}: ${error.message}` : error.message,
        kind: error.kind,
        retryable: false,
        userRejected: false,
      }
    case 'transport':
      return {
        title: 'Network error',
        detail: error.message,
        kind: error.kind,
        retryable: true,
        userRejected: false,
      }
    case 'signing':
      return {
        title: 'Signing failed',
        detail: error.message,
        kind: error.kind,
        retryable: false,
        userRejected: false,
      }
    case 'cancelled':
      return {
        title: 'Cancelled',
        detail: error.message,
        kind: error.kind,
        retryable: false,
        userRejected: true,
      }
    default:
      return {
        title: 'Something went wrong',
        detail: error.message,
        kind: error.kind,
        retryable: false,
        userRejected: false,
      }
  }
}

function orderbookTitle(category: string | undefined): string {
  switch (category) {
    case 'insufficientFunds':
      return 'Insufficient balance'
    case 'unfulfillable':
      return 'Order not currently fillable'
    case 'invalidOrder':
      return 'Order rejected'
    case 'authorization':
      return 'Not authorized'
    case 'notFound':
      return 'Not found'
    case 'conflict':
      return 'Already exists'
    case 'server':
      return 'Service unavailable'
    default:
      return 'Order error'
  }
}
