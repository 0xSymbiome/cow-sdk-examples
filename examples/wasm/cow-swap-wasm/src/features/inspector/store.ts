import { useSyncExternalStore } from 'react'

import type { QuoteResultsDto } from '@symbiome-forge/cow-sdk-wasm/trading'

// External store holding the most recent quote, so the inspector drawer can
// display the SDK's raw output for it.

interface InspectorState {
  lastQuote?: QuoteResultsDto
}

let state: InspectorState = {}
const listeners = new Set<() => void>()

export function recordQuote(quote: QuoteResultsDto): void {
  state = { lastQuote: quote }
  for (const listener of listeners) listener()
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
