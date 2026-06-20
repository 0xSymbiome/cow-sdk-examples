import { useSyncExternalStore } from 'react'

import type { QuoteResultsDto } from '@symbiome-forge/cow-sdk-wasm/trading'

// External store holding the most recent quote and the most recent transient
// retry, so the inspector drawer can display the SDK's raw output and its
// retry classification at work.

export interface RetryEvent {
  /** 1-based number of the attempt that just failed. */
  attempt: number
  /** Backoff the SDK chose before the next attempt, in milliseconds. */
  delayMs: number
  /** The retryable failure's redacted message. */
  reason: string
}

interface InspectorState {
  lastQuote?: QuoteResultsDto
  lastRetry?: RetryEvent
}

let state: InspectorState = {}
const listeners = new Set<() => void>()

function emit(next: InspectorState): void {
  state = next
  for (const listener of listeners) listener()
}

export function recordQuote(quote: QuoteResultsDto): void {
  emit({ ...state, lastQuote: quote })
}

/** Record a transient retry surfaced by `withRetry`'s `onRetry` hook. */
export function recordRetry(event: RetryEvent): void {
  emit({ ...state, lastRetry: event })
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function useInspector(): InspectorState {
  return useSyncExternalStore(subscribe, () => state)
}
