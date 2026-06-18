import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { Address, Hex } from 'viem'

import type {
  LimitTradeParametersInput,
  QuoteResultsDto,
  SwapParametersInput,
  TradingClient,
} from '@symbiome-forge/cow-sdk-wasm/trading'
import type { PublicClient, WalletClient } from 'viem'

import { QUOTE_REFRESH_INTERVAL_MS } from '../../config'
import { getTradingClient } from '../../lib/cow'
import { contractReader, typedDataSigner } from '../../lib/cow-callbacks'
import { recordQuote } from '../inspector/store'
import { useWallet } from '../../wallet/WalletProvider'

export type TradeStep = 'idle' | 'approving' | 'signing' | 'submitting'

export interface PostedOrder {
  orderId: string
  txHash?: string
}

/**
 * Live market quote for the current sell/buy/amount selection. Pass
 * `refetchActive = false` to pause polling (e.g. while the review modal is open)
 * so the amounts the user is about to sign cannot change under them.
 */
export function useQuote(
  chainId: number | undefined,
  params: SwapParametersInput | null,
  refetchActive = true,
) {
  return useQuery({
    queryKey: ['quote', chainId, params],
    enabled: chainId !== undefined && params !== null,
    refetchInterval: refetchActive ? QUOTE_REFRESH_INTERVAL_MS : false,
    retry: false,
    queryFn: async () => {
      const quote = (await getTradingClient(chainId as number).getQuote(params as SwapParametersInput))
        .value
      recordQuote(quote)
      return quote
    },
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

  const tx = (await trading.buildApprovalTx({ tokenAddress: sellToken, amount: sellAtoms })).value
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: tx.to as Address,
    data: (tx.data ?? '0x') as Hex,
    value: BigInt(tx.value ?? '0'),
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

/**
 * Executes a trade end to end: approve the sell token if needed, then sign and
 * post the order. The SDK builds the EIP-712 payload; the wallet signs it.
 */
export function useTradeExecutor() {
  const { walletClient, publicClient, account, chainId } = useWallet()
  const [step, setStep] = useState<TradeStep>('idle')

  const ready = Boolean(walletClient) && Boolean(publicClient) && account !== undefined && chainId !== undefined

  const market = useMutation<
    PostedOrder,
    Error,
    { quote: QuoteResultsDto; sellToken: string; sellAtoms: string; native: boolean }
  >({
    mutationFn: async ({ quote, sellToken, sellAtoms, native }) => {
      if (!ready) throw new Error('Connect a wallet first')
      const trading = getTradingClient(chainId as number)
      const owner = account as Address
      const wallet = walletClient as WalletClient
      try {
        if (native) {
          // Native-currency sell (eth-flow): submitted on-chain, with no ERC-20
          // approval and no off-chain signature. The SDK builds the transaction
          // straight from the quote you already hold.
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

        await ensureApproved(trading, publicClient as PublicClient, wallet, owner, sellToken, sellAtoms, setStep)
        setStep('signing')
        const posted = (
          await trading.postSwapOrderFromQuote(quote, owner, typedDataSigner(wallet, owner))
        ).value
        return { orderId: posted.orderId, ...(posted.txHash ? { txHash: posted.txHash } : {}) }
      } finally {
        setStep('idle')
      }
    },
  })

  const limit = useMutation<PostedOrder, Error, { params: LimitTradeParametersInput; sellToken: string }>({
    mutationFn: async ({ params, sellToken }) => {
      if (!ready) throw new Error('Connect a wallet first')
      const trading = getTradingClient(chainId as number)
      try {
        await ensureApproved(trading, publicClient as PublicClient, walletClient as WalletClient, account as Address, sellToken, params.sellAmount, setStep)
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
  })

  const reset = useCallback(() => {
    market.reset()
    limit.reset()
    setStep('idle')
  }, [market, limit])

  return { step, market, limit, reset, ready }
}
