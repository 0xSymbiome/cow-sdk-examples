import { describe, expect, it, vi } from 'vitest'
import type { WalletClient } from 'viem'

import {
  TradingClient,
  type OrderPlacement,
  type PresignActivationParams,
} from '@symbiome-forge/cow-sdk-wasm/trading'

import { settlePlacement, type TradeStep } from '../src/features/swap/useSwap'

// The Safe (smart-contract-wallet) swap/limit branch, exercised deterministically
// with no live network. For a Safe, `useTradeExecutor` takes the pre-sign path and
// calls `placeSwap(quote, owner, { kind: 'presign' })` / `placeLimit(...)`, which the
// SDK answers with a `pendingActivation` placement. `settlePlacement` is the runtime
// seam that follows: it turns that placement into the on-chain activation batch and
// sends it through the Safe with the shared EIP-5792 + sequential-fallback helper.
//
// The activation calls come from the SDK's own pure builder
// (`buildPresignActivationTransaction`), so the batch the Safe receives is exactly the
// ordered approve-then-setPreSignature pair a live `placeSwap`/`placeLimit` would
// emit — without touching the orderbook or a wallet.

const MAINNET = 1
const ORDER_UID = `0x${'ab'.repeat(56)}`
const SELL_TOKEN = '0x1111111111111111111111111111111111111111'
const SELL_AMOUNT = '1000000000000000000'
const OWNER = '0x3333333333333333333333333333333333333333'
const APPROVE_SELECTOR = '0x095ea7b3'

// Build the real SDK activation bundle for a posted pre-sign order — the same calls
// the placement carries — then wrap it as a `pendingActivation` placement.
function pendingActivationPlacement(): OrderPlacement {
  const client = new TradingClient({ chainId: MAINNET, appCode: 'cow-sdk-examples' })
  try {
    const params: PresignActivationParams = { orderUid: ORDER_UID, sellToken: SELL_TOKEN, amount: SELL_AMOUNT }
    const activation = client.buildPresignActivationTransaction(params).value
    return { status: 'pendingActivation', orderId: ORDER_UID, activation }
  } finally {
    client.dispose()
  }
}

describe('settlePlacement — Safe pre-sign activation', () => {
  it('sends the posted order’s [approve, setPreSignature] batch through the Safe and reports pendingActivation', async () => {
    const placement = pendingActivationPlacement()
    expect(placement.status).toBe('pendingActivation')

    // A Safe that implements EIP-5792: capture the single atomic batch.
    const sendCalls = vi.fn().mockResolvedValue({ id: '0xbatch' })
    const sendTransaction = vi.fn()
    const wallet = { sendCalls, sendTransaction } as unknown as WalletClient

    const steps: TradeStep[] = []
    const posted = await settlePlacement(placement, wallet, OWNER, (s) => steps.push(s))

    // The order id is tracked and the order is surfaced as activating, not live.
    expect(posted.orderId).toBe(ORDER_UID)
    expect(posted.pendingActivation).toBe(true)
    expect(posted.txHash).toBe('0xbatch')
    expect(steps).toContain('activating')

    // Exactly one EIP-5792 batch, from the owner Safe, with no sequential fallback.
    expect(sendCalls).toHaveBeenCalledTimes(1)
    expect(sendTransaction).not.toHaveBeenCalled()
    const arg = sendCalls.mock.calls[0]![0] as { account: string; calls: { to: string; data: string; value: bigint }[] }
    expect(arg.account).toBe(OWNER)

    // The batch is the ordered approve-then-setPreSignature pair, value-normalized to
    // bigint for viem, mirroring the activation the placement carried.
    expect(arg.calls).toHaveLength(2)
    const [approve, setPreSignature] = arg.calls
    expect(approve!.to.toLowerCase()).toBe(SELL_TOKEN.toLowerCase())
    expect(approve!.data.slice(0, 10)).toBe(APPROVE_SELECTOR)
    expect(approve!.value).toBe(0n)
    expect(setPreSignature!.to.toLowerCase()).not.toBe(SELL_TOKEN.toLowerCase())
    expect(setPreSignature!.data.slice(0, 10)).not.toBe(APPROVE_SELECTOR)
  })

  it('falls back to sequential sendTransaction when the Safe wallet has no EIP-5792', async () => {
    const placement = pendingActivationPlacement()

    // A wallet that rejects `wallet_sendCalls` with the EIP-5792 "method not found"
    // code — the shared helper must send each call sequentially instead of failing.
    const sendCalls = vi.fn().mockRejectedValue({ code: -32601, message: 'method wallet_sendCalls not found' })
    const sendTransaction = vi.fn().mockResolvedValue('0xseqhash')
    const wallet = { sendCalls, sendTransaction } as unknown as WalletClient

    const posted = await settlePlacement(placement, wallet, OWNER, () => {})

    expect(posted.pendingActivation).toBe(true)
    expect(posted.txHash).toBe('0xseqhash')
    // Both activation legs went out as individual transactions from the Safe.
    expect(sendTransaction).toHaveBeenCalledTimes(2)
    for (const call of sendTransaction.mock.calls) {
      expect((call[0] as { account: string }).account).toBe(OWNER)
    }
  })

  it('returns a bare orderId for a live placement, with no activation send', async () => {
    // The EIP-712 / EIP-1271 arms resolve to `live`: nothing to activate on-chain.
    const live: OrderPlacement = { status: 'live', orderId: ORDER_UID }
    const sendCalls = vi.fn()
    const sendTransaction = vi.fn()
    const wallet = { sendCalls, sendTransaction } as unknown as WalletClient

    const steps: TradeStep[] = []
    const posted = await settlePlacement(live, wallet, OWNER, (s) => steps.push(s))

    expect(posted.orderId).toBe(ORDER_UID)
    expect(posted.pendingActivation).toBeUndefined()
    expect(posted.txHash).toBeUndefined()
    expect(sendCalls).not.toHaveBeenCalled()
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(steps).not.toContain('activating')
  })
})
