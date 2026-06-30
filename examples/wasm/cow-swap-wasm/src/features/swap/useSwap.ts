import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { Address, Hex } from 'viem'

import { withRetry } from '@symbiome-forge/cow-sdk-wasm/trading'
import type {
  LimitTradeParams,
  OrderPlacement,
  QuoteResults,
  TradeParams,
  TradingClient,
} from '@symbiome-forge/cow-sdk-wasm/trading'
import type { PublicClient, WalletClient } from 'viem'

import { QUOTE_REFRESH_INTERVAL_MS } from '../../config'
import { getOrderBookClient, getTradingClient } from '../../lib/cow'
import { contractReader, typedDataSigner } from '../../lib/cow-callbacks'
import { isSmartContractWallet, sendCallsThroughSafe, toSafeCall } from '../../lib/safe-tx'
import { recordQuote, recordRetry } from '../inspector/store'
import { useWallet } from '../../wallet/WalletProvider'
import { MAX_UINT256, type ApprovalChoice } from './settings'

// 'activating' is the Safe pre-sign step: the order is already posted (it shows as
// pre-signature-pending in the orderbook) while the approve+setPreSignature batch is
// confirmed in the Safe.
export type TradeStep = 'idle' | 'approving' | 'signing' | 'submitting' | 'activating'

export interface PostedOrder {
  orderId: string
  txHash?: string
  /**
   * True for a Safe pre-sign order: the order is posted but only becomes fillable
   * once its on-chain activation (sent here) mines, so it is pre-signature-pending
   * rather than immediately live. The UI surfaces this as "activating", not an error.
   */
  pendingActivation?: boolean
}

/**
 * Carry an `OrderPlacement` to its conclusion. A `live` placement (an EOA EIP-712
 * order, or a smart-account EIP-1271 signature) is already fillable — return its id.
 * A `pendingActivation` placement (a Safe pre-sign order) carries the on-chain
 * approve-then-setPreSignature bundle; submit it through the Safe with the shared
 * EIP-5792 batch + sequential fallback, then report it as pending activation.
 *
 * Exported for the deterministic Safe-branch test (no React, no network): it is the
 * seam where a posted pre-sign placement turns into the Safe activation batch.
 */
export async function settlePlacement(
  placement: OrderPlacement,
  walletClient: WalletClient,
  owner: Address,
  setStep: (step: TradeStep) => void,
): Promise<PostedOrder> {
  if (placement.status === 'live') return { orderId: placement.orderId }
  setStep('activating')
  const calls = placement.activation.calls.map(toSafeCall)
  const txHash = await sendCallsThroughSafe(walletClient, owner, calls)
  return { orderId: placement.orderId, txHash, pendingActivation: true }
}

/**
 * Live market quote for the current sell/buy/amount selection. Pass
 * `refetchActive = false` to pause polling (e.g. while the review modal is open)
 * so the amounts the user is about to sign cannot change under them.
 */
export function useQuote(
  chainId: number | undefined,
  params: TradeParams | null,
  refetchActive = true,
) {
  return useQuery({
    queryKey: ['quote', chainId, params],
    enabled: chainId !== undefined && params !== null,
    refetchInterval: refetchActive ? QUOTE_REFRESH_INTERVAL_MS : false,
    retry: false,
    queryFn: async () => {
      // Retry only a transient orderbook failure — on the SDK's own `isRetryable`
      // verdict and any `Retry-After` it parsed — under a tight, stale-quote-aware
      // budget. A rejection decided on the request's merits is never retried.
      const quote = await withRetry(
        () =>
          getTradingClient(chainId as number)
            .getQuote(params as TradeParams)
            .then((envelope) => envelope.value),
        {
          retries: 2,
          baseDelayMs: 400,
          maxDelayMs: 2_000,
          onRetry: (attempt, error, delayMs) => recordRetry({ attempt, delayMs, reason: error.message }),
        },
      )
      recordQuote(quote)
      return quote
    },
  })
}

/**
 * The token's native-currency price (per atom), used to estimate price impact.
 * Prices move slowly, so the result is cached; a failure resolves to no price so
 * the caller can simply omit the impact line.
 */
export function useNativePrice(chainId: number | undefined, tokenAddress: string | undefined) {
  return useQuery({
    queryKey: ['native-price', chainId, tokenAddress],
    enabled: chainId !== undefined && tokenAddress !== undefined,
    staleTime: 60_000,
    retry: false,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getNativePrice(tokenAddress as string)
        .then((envelope) => envelope.value.price),
  })
}

/**
 * Whether the sell token needs a one-time approval before the order can settle.
 * Reads the current CoW allowance and compares it to the sell amount.
 */
export function useNeedsApproval(
  sellTokenAddress: string | undefined,
  sellAtoms: string | undefined,
  native: boolean,
) {
  const { publicClient, account, chainId } = useWallet()
  return useQuery({
    queryKey: ['needs-approval', chainId, account, sellTokenAddress, sellAtoms],
    enabled:
      !native &&
      Boolean(publicClient) &&
      account !== undefined &&
      chainId !== undefined &&
      Boolean(sellTokenAddress) &&
      Boolean(sellAtoms),
    queryFn: async () => {
      const allowance = (
        await getTradingClient(chainId as number).getCowProtocolAllowance(
          { tokenAddress: sellTokenAddress as string, owner: account as Address },
          contractReader(publicClient as PublicClient),
        )
      ).value
      return BigInt(allowance) < BigInt(sellAtoms as string)
    },
  })
}

async function ensureApproved(
  trading: TradingClient,
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address,
  sellToken: string,
  sellAtoms: string,
  approveAmount: string,
  setStep: (step: TradeStep) => void,
): Promise<void> {
  setStep('approving')
  const allowance = (
    await trading.getCowProtocolAllowance(
      { tokenAddress: sellToken, owner: account },
      contractReader(publicClient),
    )
  ).value
  if (BigInt(allowance) >= BigInt(sellAtoms)) return

  const tx = (await trading.buildApprovalTx({ tokenAddress: sellToken, amount: approveAmount })).value
  const to = tx.to as Address
  const data = (tx.data ?? '0x') as Hex
  const value = BigInt(tx.value ?? '0')
  // The SDK leaves approve gas to the caller. Bound it here — estimate plus a 20%
  // margin, with a fixed fallback — so a wallet or node over-estimate cannot be
  // rejected as "gas limit too high".
  const estimated = await publicClient.estimateGas({ account, to, data, value }).catch(() => 150_000n)
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    to,
    data,
    value,
    gas: (estimated * 12n) / 10n,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

/**
 * Executes a trade end to end: approve the sell token if needed, then sign and
 * post the order. The SDK builds the EIP-712 payload; the wallet signs it.
 */
export function useTradeExecutor() {
  const { walletClient, publicClient, account, chainId } = useWallet()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<TradeStep>('idle')

  const ready = Boolean(walletClient) && Boolean(publicClient) && account !== undefined && chainId !== undefined

  const market = useMutation<
    PostedOrder,
    Error,
    { quote: QuoteResults; sellToken: string; sellAtoms: string; native: boolean; approval: ApprovalChoice }
  >({
    mutationFn: async ({ quote, sellToken, sellAtoms, native, approval }) => {
      if (!ready) throw new Error('Connect a wallet first')
      const trading = getTradingClient(chainId as number)
      const owner = account as Address
      const wallet = walletClient as WalletClient
      try {
        if (native) {
          // Native-currency sell (eth-flow): submitted on-chain, with no ERC-20
          // approval and no off-chain signature. The SDK builds the transaction
          // straight from the quote you already hold. (Out of scope for the Safe
          // pre-sign path — a Safe native sell keeps this behavior.)
          setStep('submitting')
          const built = (await trading.buildSellNativeCurrencyTxFromQuote(quote, owner)).value
          const tx = built.transaction
          const hash = await wallet.sendTransaction({
            account: owner,
            chain: null,
            to: tx.to as Address,
            data: (tx.data ?? '0x') as Hex,
            value: BigInt(tx.value ?? '0'),
          })
          return { orderId: built.orderUid, txHash: hash }
        }

        // Safe (smart-contract wallet), ERC-20 sell: pre-sign is the canonical path
        // for a Safe — it never produces an off-chain order signature. `placeSwap`
        // with the `presign` authorization posts the order; `settlePlacement` then
        // sends the bundled approve+setPreSignature through the Safe, so no separate
        // ERC-20 approval is done here.
        if (await isSmartContractWallet(publicClient as PublicClient, owner)) {
          setStep('submitting')
          const placement = (await trading.placeSwap(quote, owner, { kind: 'presign' })).value
          return settlePlacement(placement, wallet, owner, setStep)
        }

        // EOA: the working EIP-712 path — approve the sell token (gas-bounded), then
        // sign and post the order gaslessly.
        await ensureApproved(
          trading,
          publicClient as PublicClient,
          wallet,
          owner,
          sellToken,
          sellAtoms,
          approval === 'unlimited' ? MAX_UINT256 : sellAtoms,
          setStep,
        )
        setStep('signing')
        const posted = (
          await trading.postSwapOrderFromQuote(quote, owner, typedDataSigner(wallet, owner))
        ).value
        return { orderId: posted.orderId, ...(posted.txHash ? { txHash: posted.txHash } : {}) }
      } finally {
        setStep('idle')
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['orders', chainId, account] }),
  })

  const limit = useMutation<
    PostedOrder,
    Error,
    { params: LimitTradeParams; sellToken: string; approval: ApprovalChoice }
  >({
    mutationFn: async ({ params, sellToken, approval }) => {
      if (!ready) throw new Error('Connect a wallet first')
      const trading = getTradingClient(chainId as number)
      const owner = account as Address
      const wallet = walletClient as WalletClient
      try {
        // Safe (smart-contract wallet): pre-sign limit order, mirroring the swap
        // path. `placeLimit` with the `presign` authorization posts the limit order;
        // `settlePlacement` then sends the bundled approve+setPreSignature through the
        // Safe, so no separate ERC-20 approval is done here.
        if (await isSmartContractWallet(publicClient as PublicClient, owner)) {
          setStep('submitting')
          const placement = (await trading.placeLimit(params, owner, { kind: 'presign' })).value
          return settlePlacement(placement, wallet, owner, setStep)
        }

        await ensureApproved(
          trading,
          publicClient as PublicClient,
          walletClient as WalletClient,
          account as Address,
          sellToken,
          params.sellAmount,
          approval === 'unlimited' ? MAX_UINT256 : params.sellAmount,
          setStep,
        )
        setStep('signing')
        const posted = (
          await trading.postLimitOrder(
            params,
            account as Address,
            typedDataSigner(walletClient as WalletClient, account as Address),
          )
        ).value
        return { orderId: posted.orderId, ...(posted.txHash ? { txHash: posted.txHash } : {}) }
      } finally {
        setStep('idle')
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['orders', chainId, account] }),
  })

  const reset = useCallback(() => {
    market.reset()
    limit.reset()
    setStep('idle')
  }, [market, limit])

  return { step, market, limit, reset, ready }
}
