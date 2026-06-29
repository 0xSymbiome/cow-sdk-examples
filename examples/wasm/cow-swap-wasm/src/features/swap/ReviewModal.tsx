import { useState } from 'react'

import type { QuoteResults } from '@symbiome-forge/cow-sdk-wasm/trading'

import { formatAmount, toAtoms } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { Button } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { TokenLogo } from '../../ui/TokenLogo'
import { useToast } from '../../ui/toast'
import type { TokenInfo } from '../../tokens/tokens'
import { manualSlippageBps, resolvedReceiver, validForSeconds, type SwapSettings } from './settings'
import { useNeedsApproval, useTradeExecutor, type TradeStep } from './useSwap'

interface ReviewModalProps {
  mode: 'market' | 'limit'
  // Which side is exact: 'sell' (quote the buy) or 'buy' (quote the sell). Market only.
  side: 'sell' | 'buy'
  sellToken: TokenInfo
  buyToken: TokenInfo
  sellAmount: string
  buyAmount: string
  limitBuyAmount: string
  settings: SwapSettings
  quote: QuoteResults | undefined
  onClose: () => void
  onDone: () => void
}

function stepLabel(step: TradeStep, sellSymbol: string): string {
  switch (step) {
    case 'approving':
      return `Step 1 of 2 — approve ${sellSymbol} in your wallet (a one-time transaction)…`
    case 'signing':
      return 'Step 2 of 2 — sign the order in your wallet. If no prompt appeared, open your wallet: the request may be waiting there.'
    case 'submitting':
      return 'Submitting your order…'
    default:
      return ''
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function ReviewModal({
  mode,
  side,
  sellToken,
  buyToken,
  sellAmount,
  buyAmount,
  limitBuyAmount,
  settings,
  quote: liveQuote,
  onClose,
  onDone,
}: ReviewModalProps) {
  // Freeze the quote when the modal opens so the reviewed and signed amounts match.
  const [quote] = useState(liveQuote)
  const { step, market, limit } = useTradeExecutor()
  const toast = useToast()

  // The sell the order actually spends: the order's signed sell amount for a market
  // swap (exact when selling, the quoted max when buying), or the user's amount for limit.
  const sellAtoms =
    mode === 'market' && quote ? quote.amountsAndCosts.amountsToSign.sellAmount : toAtoms(sellAmount, sellToken.decimals)
  const needsApproval = useNeedsApproval(sellToken.address, sellAtoms, sellToken.native === true)

  const pending = step !== 'idle' || market.isPending || limit.isPending

  const manualBps = manualSlippageBps(settings)
  const receiver = resolvedReceiver(settings)
  const validFor = validForSeconds(settings, mode)
  // Slippage applies to swaps only; a limit order's buy amount is the exact floor.
  const displaySlippageBps = manualBps ?? quote?.suggestedSlippageBps
  const slippageAuto = mode === 'market' && settings.slippage.mode === 'auto'

  // The fixed side is the user's exact input; the other side is the SDK's estimate.
  const buyIsExact = mode === 'market' && side === 'buy'
  const sellLegLabel = buyIsExact ? 'You sell (expected)' : 'You sell'
  const sellLegAmount =
    buyIsExact && quote
      ? formatAmount(quote.amountsAndCosts.afterPartnerFees.sellAmount, sellToken.decimals)
      : sellAmount
  const buyLegLabel =
    mode === 'limit' ? 'You receive (at limit)' : buyIsExact ? 'You receive' : 'You receive (expected)'
  const buyLegAmount =
    mode === 'limit'
      ? limitBuyAmount
      : buyIsExact
        ? buyAmount
        : quote
          ? formatAmount(quote.amountsAndCosts.afterPartnerFees.buyAmount, buyToken.decimals)
          : ''

  // The slippage-protected bound flips with the side: a floor on the buy when
  // selling, a ceiling on the sell when buying. Limit uses its exact buy floor.
  const bound =
    mode === 'market' && quote
      ? side === 'sell'
        ? {
            label: 'Minimum received',
            amount: formatAmount(quote.amountsAndCosts.afterSlippage.buyAmount, buyToken.decimals),
            symbol: buyToken.symbol,
          }
        : {
            label: 'Maximum sold',
            amount: formatAmount(quote.amountsAndCosts.afterSlippage.sellAmount, sellToken.decimals),
            symbol: sellToken.symbol,
          }
      : { label: 'Minimum received', amount: limitBuyAmount, symbol: buyToken.symbol }

  function onError(error: unknown) {
    const ui = toUiError(error)
    toast.push({ tone: ui.userRejected ? 'info' : 'danger', title: ui.title, detail: ui.detail })
  }

  function onSuccess() {
    toast.push({
      tone: 'success',
      title: mode === 'market' ? 'Order submitted' : 'Limit order placed',
      detail: 'Track it in the activity panel.',
    })
    onDone()
  }

  function confirm() {
    if (mode === 'market') {
      if (!quote) return
      market.mutate(
        {
          quote,
          sellToken: sellToken.address,
          sellAtoms,
          native: sellToken.native === true,
          approval: settings.approval,
        },
        { onSuccess, onError },
      )
      return
    }
    limit.mutate(
      {
        params: {
          kind: 'sell',
          sellToken: sellToken.address as `0x${string}`,
          buyToken: buyToken.address as `0x${string}`,
          sellAmount: toAtoms(sellAmount, sellToken.decimals),
          buyAmount: toAtoms(limitBuyAmount, buyToken.decimals),
          validFor,
          // The limit price is the exact floor — no slippage haircut.
          slippageBps: 0,
          partiallyFillable: settings.partialFills,
          ...(receiver !== undefined ? { receiver: receiver as `0x${string}` } : {}),
        },
        sellToken: sellToken.address,
        approval: settings.approval,
      },
      { onSuccess, onError },
    )
  }

  return (
    <Modal open onClose={pending ? () => undefined : onClose} title={mode === 'market' ? 'Review swap' : 'Review limit order'}>
      <div className="review">
        <div className="review-leg">
          <TokenLogo token={sellToken} />
          <div>
            <small>{sellLegLabel}</small>
            <strong>
              {sellLegAmount} {sellToken.symbol}
            </strong>
          </div>
        </div>
        <div className="review-arrow">↓</div>
        <div className="review-leg">
          <TokenLogo token={buyToken} />
          <div>
            <small>{buyLegLabel}</small>
            <strong>
              {buyLegAmount} {buyToken.symbol}
            </strong>
          </div>
        </div>

        <dl className="review-details">
          <div>
            <dt>{bound.label}</dt>
            <dd>
              {bound.amount} {bound.symbol}
            </dd>
          </div>
          {mode === 'market' && quote ? (
            <div>
              <dt>Network cost</dt>
              <dd>
                {formatAmount(
                  quote.amountsAndCosts.costs.networkFee.amountInSellCurrency,
                  sellToken.decimals,
                  6,
                )}{' '}
                {sellToken.symbol}
              </dd>
            </div>
          ) : null}
          {mode === 'market' ? (
            <div>
              <dt>Slippage tolerance{slippageAuto ? ' (auto)' : ''}</dt>
              <dd>{displaySlippageBps !== undefined ? `${(displaySlippageBps / 100).toFixed(2)}%` : '—'}</dd>
            </div>
          ) : null}
          <div>
            <dt>Expires in</dt>
            <dd>{mode === 'limit' ? `${Math.round(validFor / 86_400)} days` : `${Math.round(validFor / 60)} min`}</dd>
          </div>
          {mode === 'limit' ? (
            <div>
              <dt>Partial fills</dt>
              <dd>{settings.partialFills ? 'Allowed' : 'Fill or kill'}</dd>
            </div>
          ) : null}
          {receiver ? (
            <div>
              <dt>Recipient</dt>
              <dd>{shortAddress(receiver)}</dd>
            </div>
          ) : null}
          {mode === 'market' && quote ? (
            <div>
              <dt>Quote id</dt>
              <dd>{quote.quoteResponse.id ?? '—'}</dd>
            </div>
          ) : null}
        </dl>

        {!pending && needsApproval.data ? (
          <p className="notice">
            {settings.approval === 'unlimited'
              ? `First ${sellToken.symbol} swap: approve it once (an on-chain transaction), then sign the order — which is gasless. Later ${sellToken.symbol} swaps need only the signature.`
              : `First, approve exactly this ${sellToken.symbol} amount (an on-chain transaction), then sign the order — which is gasless. Each new ${sellToken.symbol} swap re-approves.`}
          </p>
        ) : null}

        {pending ? <p className="notice">{stepLabel(step, sellToken.symbol)}</p> : null}

        <Button variant="primary" className="swap-action" loading={pending} onClick={confirm}>
          {mode === 'market' ? 'Confirm swap' : 'Place limit order'}
        </Button>
        <p className="review-foot">
          {sellToken.native
            ? "Native sells submit an on-chain order through CoW's eth-flow contract — confirm the transaction in your wallet."
            : 'CoW Protocol settles your order gaslessly — you only sign; no private key touches the SDK.'}
        </p>
      </div>
    </Modal>
  )
}
