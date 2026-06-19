import { useState } from 'react'

import type { QuoteResultsDto } from '@symbiome-forge/cow-sdk-wasm/trading'

import { formatAmount, toAtoms } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { Button } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { TokenLogo } from '../../ui/TokenLogo'
import { useToast } from '../../ui/toast'
import type { TokenInfo } from '../../tokens/tokens'
import { useNeedsApproval, useTradeExecutor, type TradeStep } from './useSwap'

interface ReviewModalProps {
  mode: 'market' | 'limit'
  sellToken: TokenInfo
  buyToken: TokenInfo
  sellAmount: string
  limitBuyAmount: string
  slippageBps: number
  quote: QuoteResultsDto | undefined
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

export function ReviewModal({
  mode,
  sellToken,
  buyToken,
  sellAmount,
  limitBuyAmount,
  slippageBps,
  quote: liveQuote,
  onClose,
  onDone,
}: ReviewModalProps) {
  // Freeze the quote when the modal opens so the reviewed and signed amounts match.
  const [quote] = useState(liveQuote)
  const { step, market, limit } = useTradeExecutor()
  const toast = useToast()
  const sellAtoms = toAtoms(sellAmount, sellToken.decimals)
  const needsApproval = useNeedsApproval(sellToken.address, sellAtoms, sellToken.native === true)

  const pending = step !== 'idle' || market.isPending || limit.isPending

  const buyDisplay =
    mode === 'market' && quote
      ? formatAmount(quote.amountsAndCosts.afterPartnerFees.buyAmount, buyToken.decimals)
      : limitBuyAmount
  const minReceived =
    mode === 'market' && quote
      ? formatAmount(quote.amountsAndCosts.afterSlippage.buyAmount, buyToken.decimals)
      : limitBuyAmount

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
        },
        { onSuccess, onError },
      )
      return
    }
    limit.mutate(
      {
        params: {
          kind: 'sell',
          sellToken: sellToken.address,
          buyToken: buyToken.address,
          sellAmount: toAtoms(sellAmount, sellToken.decimals),
          buyAmount: toAtoms(limitBuyAmount, buyToken.decimals),
          slippageBps,
        },
        sellToken: sellToken.address,
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
            <small>You sell</small>
            <strong>
              {sellAmount} {sellToken.symbol}
            </strong>
          </div>
        </div>
        <div className="review-arrow">↓</div>
        <div className="review-leg">
          <TokenLogo token={buyToken} />
          <div>
            <small>{mode === 'market' ? 'You receive (expected)' : 'You receive (at limit)'}</small>
            <strong>
              {buyDisplay} {buyToken.symbol}
            </strong>
          </div>
        </div>

        <dl className="review-details">
          <div>
            <dt>Minimum received</dt>
            <dd>
              {minReceived} {buyToken.symbol}
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
          <div>
            <dt>Slippage tolerance</dt>
            <dd>{(slippageBps / 100).toFixed(2)}%</dd>
          </div>
          {mode === 'market' && quote ? (
            <div>
              <dt>Quote id</dt>
              <dd>{quote.quoteResponse.id ?? '—'}</dd>
            </div>
          ) : null}
        </dl>

        {!pending && needsApproval.data ? (
          <p className="notice">
            First {sellToken.symbol} swap: you approve it once (an on-chain transaction), then sign
            the order — which is gasless. Later {sellToken.symbol} swaps need only the signature.
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
