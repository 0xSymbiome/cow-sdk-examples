import { useSyncExternalStore } from 'react'

// TWAPs created here, tracked locally so the Activity panel shows them immediately
// — before the Safe executes the create and the watch tower posts the first part to
// the order book (when they'd otherwise appear). Each part shows as a normal order once live.
export interface SubmittedTwap {
  orderId: string
  chainId: number
  account: string
  sellToken: string
  buyToken: string
  /** Total sell across all parts, in atoms. */
  sellAmount: string
  /** Total minimum buy across all parts, in atoms. */
  buyAmount: string
  numberOfParts: number
  createdAt: number
}

let twaps: SubmittedTwap[] = []
const listeners = new Set<() => void>()

/** Record a freshly created TWAP (deduped by order id, newest first). */
export function recordTwap(twap: SubmittedTwap): void {
  twaps = [twap, ...twaps.filter((existing) => existing.orderId !== twap.orderId)]
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function useSubmittedTwaps(): SubmittedTwap[] {
  return useSyncExternalStore(subscribe, () => twaps)
}
