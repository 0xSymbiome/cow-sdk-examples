import { useMemo, useState } from 'react'

import type { SwapParametersInput } from '@symbiome-forge/cow-sdk-wasm/trading'

import { DEFAULT_SLIPPAGE_BPS } from '../../config'
import { formatAmount, fromAtoms, isPositiveAmount, toAtoms } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { isSupportedChain } from '../../chains/registry'
import { useBalances, useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Button } from '../../ui/primitives'
import { TokenLogo } from '../../ui/TokenLogo'
import { useWallet } from '../../wallet/WalletProvider'
import { ReviewModal } from './ReviewModal'
import { TokenSelect } from './TokenSelect'
import { useQuote } from './useSwap'

type Mode = 'market' | 'limit'
type Side = 'sell' | 'buy'

function pickDefault(tokens: TokenInfo[], symbol: string): TokenInfo | undefined {
  return tokens.find((token) => token.symbol.toUpperCase() === symbol)
}

export function SwapCard() {
  const { chainId, account } = useWallet()
  const tokenList = useTokenList(chainId)
  const tokens = useMemo(() => tokenList.data ?? [], [tokenList.data])

  const [mode, setMode] = useState<Mode>('market')
  const [sellSel, setSellSel] = useState<TokenInfo>()
  const [buySel, setBuySel] = useState<TokenInfo>()
  const [sellAmount, setSellAmount] = useState('')
  const [limitBuyAmount, setLimitBuyAmount] = useState('')
  const [slippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [picking, setPicking] = useState<Side>()
  const [reviewing, setReviewing] = useState(false)

  // Derive the active tokens during render: keep the user's selection while it
  // belongs to the current chain's list, otherwise fall back to sensible
  // defaults. No effect needed — the selection follows the chain automatically.
  // A selection survives a chain switch only if it belongs to the *current* chain.
  // The native sentinel address is identical on every chain, so address alone is
  // not enough — compare the chain id too.
  const inList = (token: TokenInfo | undefined) =>
    token !== undefined &&
    tokens.some(
      (candidate) => candidate.address === token.address && candidate.chainId === token.chainId,
    )
  const sellToken = inList(sellSel)
    ? sellSel
    : (pickDefault(tokens, 'WETH') ?? tokens.find((token) => !token.native) ?? tokens[0])
  const buyToken = inList(buySel)
    ? buySel
    : (pickDefault(tokens, 'USDC') ??
      pickDefault(tokens, 'COW') ??
      tokens.find((token) => token.address !== sellToken?.address) ??
      tokens[1])

  const selectedTokens = useMemo(
    () => [sellToken, buyToken].filter((token): token is TokenInfo => token !== undefined),
    [sellToken, buyToken],
  )
  const balances = useBalances(selectedTokens)
  const sellBalance = sellToken ? balances.data?.[sellToken.address] : undefined
  const buyBalance = buyToken ? balances.data?.[buyToken.address] : undefined

  function setMax() {
    if (!sellToken || sellBalance === undefined) return
    if (sellToken.native) {
      // Leave a small reserve so the eth-flow transaction still has gas.
      const reserve = BigInt(toAtoms('0.001', 18))
      const balance = BigInt(sellBalance)
      setSellAmount(fromAtoms(balance > reserve ? balance - reserve : 0n, sellToken.decimals))
    } else {
      setSellAmount(fromAtoms(sellBalance, sellToken.decimals))
    }
  }

  const wrongNetwork = chainId !== undefined && !isSupportedChain(chainId)

  const swapParams: SwapParametersInput | null = useMemo(() => {
    if (mode !== 'market' || !sellToken || !buyToken || account === undefined) return null
    if (!isPositiveAmount(sellAmount, sellToken.decimals)) return null
    // The SDK requires an owner for quote-only flows; it builds the order-to-sign
    // payload for the connected account.
    return {
      kind: 'sell',
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      amount: toAtoms(sellAmount, sellToken.decimals),
      slippageBps,
      owner: account,
    }
  }, [mode, sellToken, buyToken, account, sellAmount, slippageBps])

  // Pause quote polling while the review modal is open so the amounts cannot
  // change between the user reading them and signing.
  const quote = useQuote(chainId, swapParams, !reviewing)

  const buyDisplay =
    mode === 'market'
      ? quote.data && buyToken
        ? formatAmount(quote.data.amountsAndCosts.afterPartnerFees.buyAmount, buyToken.decimals)
        : ''
      : limitBuyAmount

  function flip() {
    setSellSel(buyToken)
    setBuySel(sellToken)
    setSellAmount('')
    setLimitBuyAmount('')
  }

  const amountEntered = isPositiveAmount(sellAmount, sellToken?.decimals ?? 18)
  // Require the balance only for a market swap. A limit order is a standing intent
  // the user may fund later, so it is allowed above the current balance.
  const insufficientBalance =
    mode === 'market' &&
    amountEntered &&
    sellToken !== undefined &&
    sellBalance !== undefined &&
    BigInt(toAtoms(sellAmount, sellToken.decimals)) > BigInt(sellBalance)
  const limitReady =
    mode === 'limit' && amountEntered && isPositiveAmount(limitBuyAmount, buyToken?.decimals ?? 18)
  const marketReady = mode === 'market' && Boolean(quote.data)
  const canReview =
    account !== undefined && !wrongNetwork && !insufficientBalance && (marketReady || limitReady)

  return (
    <section className="card swap-card">
      <div className="tabs">
        <button type="button" className={mode === 'market' ? 'tab tab-active' : 'tab'} onClick={() => setMode('market')}>
          Swap
        </button>
        <button type="button" className={mode === 'limit' ? 'tab tab-active' : 'tab'} onClick={() => setMode('limit')}>
          Limit
        </button>
      </div>

      <TokenField
        label="Sell"
        token={sellToken}
        amount={sellAmount}
        editable
        balanceAtoms={sellBalance}
        onMax={setMax}
        onAmount={setSellAmount}
        onPick={() => setPicking('sell')}
      />

      <div className="flip-row">
        <button type="button" className="icon-btn flip-btn" onClick={flip} aria-label="Switch tokens">
          ↓
        </button>
      </div>

      <TokenField
        label={mode === 'limit' ? 'Buy (at limit price)' : 'Buy'}
        token={buyToken}
        amount={buyDisplay}
        editable={mode === 'limit'}
        loading={mode === 'market' && quote.isFetching && !quote.data}
        balanceAtoms={buyBalance}
        onAmount={setLimitBuyAmount}
        onPick={() => setPicking('buy')}
      />

      {mode === 'market' && quote.isError ? (
        <p className="error-text">{toUiError(quote.error).detail}</p>
      ) : null}

      {mode === 'market' && quote.data && sellToken && buyToken ? (
        <QuoteSummary
          minReceived={formatAmount(
            quote.data.amountsAndCosts.afterSlippage.buyAmount,
            buyToken.decimals,
          )}
          buySymbol={buyToken.symbol}
          networkCost={formatAmount(
            quote.data.amountsAndCosts.costs.networkFee.amountInSellCurrency,
            sellToken.decimals,
            6,
          )}
          sellSymbol={sellToken.symbol}
          slippageBps={slippageBps}
          expiration={quote.data.quoteResponse.expiration}
        />
      ) : null}

      <Button
        variant="primary"
        className="swap-action"
        disabled={!canReview}
        onClick={() => setReviewing(true)}
      >
        {account === undefined
          ? 'Connect a wallet'
          : wrongNetwork
            ? 'Unsupported network'
            : !amountEntered
              ? 'Enter an amount'
              : insufficientBalance
                ? `Insufficient ${sellToken?.symbol ?? ''} balance`
                : mode === 'market' && quote.isFetching && !quote.data
                  ? 'Fetching quote…'
                  : 'Review order'}
      </Button>

      <TokenSelect
        open={picking !== undefined}
        onClose={() => setPicking(undefined)}
        tokens={tokens}
        excludeAddress={picking === 'sell' ? buyToken?.address : sellToken?.address}
        onSelect={(token) => {
          if (picking === 'sell') setSellSel(token)
          else setBuySel(token)
        }}
      />

      {reviewing && sellToken && buyToken ? (
        <ReviewModal
          mode={mode}
          sellToken={sellToken}
          buyToken={buyToken}
          sellAmount={sellAmount}
          limitBuyAmount={limitBuyAmount}
          slippageBps={slippageBps}
          quote={mode === 'market' ? quote.data : undefined}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false)
            setSellAmount('')
            setLimitBuyAmount('')
          }}
        />
      ) : null}
    </section>
  )
}

interface TokenFieldProps {
  label: string
  token: TokenInfo | undefined
  amount: string
  editable: boolean
  loading?: boolean
  balanceAtoms?: string
  onAmount: (value: string) => void
  onPick: () => void
  onMax?: () => void
}

function TokenField({
  label,
  token,
  amount,
  editable,
  loading,
  balanceAtoms,
  onAmount,
  onPick,
  onMax,
}: TokenFieldProps) {
  return (
    <div className="token-field">
      <span className="token-field-label">{label}</span>
      <div className="token-field-row">
        {/* No real token amount needs this many characters; the cap stops pathological input. */}
        <input
          className={`amount-input${amount.length > 18 ? ' amount-xs' : amount.length > 11 ? ' amount-sm' : ''}`}
          inputMode="decimal"
          maxLength={30}
          placeholder={loading ? '…' : '0.0'}
          value={amount}
          readOnly={!editable}
          onChange={(event) => {
            // Some mobile keypads emit the locale decimal separator (a comma); store a dot.
            const next = event.target.value.replace(/,/g, '.')
            if (next === '' || /^\d*\.?\d*$/.test(next)) onAmount(next)
          }}
        />
        <button type="button" className="token-pick" onClick={onPick}>
          {token ? (
            <>
              <TokenLogo token={token} size={22} />
              <span>{token.symbol}</span>
            </>
          ) : (
            <span>Select</span>
          )}
          <span className="chevron">▾</span>
        </button>
      </div>
      {token && balanceAtoms !== undefined ? (
        <div className="token-field-meta">
          <span className="balance">
            Balance: {formatAmount(balanceAtoms, token.decimals, 4)} {token.symbol}
          </span>
          {onMax ? (
            <button type="button" className="max-btn" onClick={onMax}>
              Max
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

interface QuoteSummaryProps {
  minReceived: string
  buySymbol: string
  networkCost: string
  sellSymbol: string
  slippageBps: number
  expiration: string
}

function QuoteSummary({
  minReceived,
  buySymbol,
  networkCost,
  sellSymbol,
  slippageBps,
  expiration,
}: QuoteSummaryProps) {
  return (
    <dl className="quote-summary">
      <div>
        <dt>Minimum received</dt>
        <dd>
          {minReceived} {buySymbol}
        </dd>
      </div>
      <div>
        <dt>Network cost</dt>
        <dd>
          {networkCost} {sellSymbol}
        </dd>
      </div>
      <div>
        <dt>Slippage tolerance</dt>
        <dd>{(slippageBps / 100).toFixed(2)}%</dd>
      </div>
      <div>
        <dt>Quote expires</dt>
        <dd>{new Date(expiration).toLocaleTimeString()}</dd>
      </div>
    </dl>
  )
}
