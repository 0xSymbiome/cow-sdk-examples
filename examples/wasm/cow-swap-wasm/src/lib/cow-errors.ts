import {
  isCowError,
  isRetryable,
  isUserRejection,
  retryAfterMs,
  type OrderBookErrorType,
  type OrderBookRejectionCategory,
} from '@symbiome-forge/cow-sdk-wasm/trading'

// Every SDK call throws a `CowError` — a real `Error` subclass that is also a
// discriminated union keyed by `kind`. The SDK already classifies the failure
// (`isRetryable`, `isUserRejection`, the `Retry-After` it parsed, the services
// `errorType` tag), so this module only maps that verdict onto presentational
// UI state. The classification logic lives in the SDK, not here.

/** The next step the user can take to clear a recoverable orderbook rejection. */
export type UiAction = 'approve' | 'fund' | 'requote'

export interface UiError {
  title: string
  detail: string
  kind: string
  retryable: boolean
  retryAfterMs?: number
  /** A user-initiated rejection (declined signature or cancelled flow) — shown softly. */
  userRejected: boolean
  /** Set when the orderbook's `errorType` names a concrete fix the user can take. */
  action?: UiAction
}

export function toUiError(error: unknown): UiError {
  // `isCowError` is the SDK's own `instanceof CowError`. A non-SDK fault (e.g. a
  // wallet adapter throwing) is shown verbatim rather than guessed at.
  if (!isCowError(error)) {
    return {
      title: 'Unexpected error',
      detail: error instanceof Error ? error.message : String(error),
      kind: 'unknown',
      retryable: false,
      userRejected: false,
    }
  }

  // The SDK computes these verdicts; the UI does not re-derive them.
  const base = {
    kind: error.kind,
    retryable: isRetryable(error),
    userRejected: isUserRejection(error),
  }

  // `switch (error.kind)` narrows the union to the typed per-kind fields.
  switch (error.kind) {
    case 'walletRequest':
      return {
        ...base,
        title: base.userRejected ? 'Signature declined' : 'Wallet request failed',
        detail: error.message,
      }
    case 'walletTimeout':
      return {
        ...base,
        title: 'Wallet timed out',
        detail: `No wallet response within ${Math.round(error.timeoutMs / 1000)}s.`,
      }
    case 'unsupportedChain':
      return {
        ...base,
        title: 'Unsupported network',
        detail: `Chain ${error.chainId} is not supported. Switch to a supported network.`,
      }
    case 'orderbook': {
      const after = retryAfterMs(error)
      const action = orderbookAction(error.errorType)
      return {
        ...base,
        // `errorType` refines the coarse `category`: an allowance failure and a
        // balance failure both fall under `insufficientFunds`, but only the
        // former is fixed by an approval — so prefer the tag where it is sharper.
        title:
          error.errorType === 'InsufficientAllowance'
            ? 'Token approval needed'
            : orderbookTitle(error.category),
        detail: error.message,
        ...(after === undefined ? {} : { retryAfterMs: after }),
        ...(action === undefined ? {} : { action }),
      }
    }
    case 'invalidInput':
      return {
        ...base,
        title: 'Invalid input',
        detail: error.field ? `${error.field}: ${error.message}` : error.message,
      }
    case 'transport':
      return { ...base, title: 'Network error', detail: error.message }
    case 'appData':
      return { ...base, title: 'App data rejected', detail: error.message }
    case 'signing':
      return { ...base, title: 'Signing failed', detail: error.message }
    case 'cancelled':
      return { ...base, title: 'Cancelled', detail: error.message }
    default:
      return { ...base, title: 'Something went wrong', detail: error.message }
  }
}

function orderbookTitle(category: OrderBookRejectionCategory | undefined): string {
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

// Map the services `errorType` tag — finer than `category` — onto the concrete
// recovery the UI can offer. Exported so the mapping is unit-tested directly.
export function orderbookAction(errorType: OrderBookErrorType | undefined): UiAction | undefined {
  switch (errorType) {
    case 'InsufficientAllowance':
      return 'approve'
    case 'InsufficientBalance':
    case 'SellAmountDoesNotCoverFee':
      return 'fund'
    case 'QuoteNotFound':
    case 'QuoteNotVerified':
    case 'InvalidQuote':
      return 'requote'
    default:
      return undefined
  }
}
