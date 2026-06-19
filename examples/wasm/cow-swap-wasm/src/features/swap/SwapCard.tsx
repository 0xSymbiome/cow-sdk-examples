import { useMemo, useState } from 'react'
import { isAddress } from 'viem'

import type { SwapParametersInput } from '@symbiome-forge/cow-sdk-wasm/trading'

import { formatAmount, fromAtoms, isPositiveAmount, toAtoms } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { isSupportedChain } from '../../chains/registry'
import { useBalances, useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Button } from '../../ui/primitives'
import { TokenLogo } from '../../ui/TokenLogo'
import { useWallet } from '../../wallet/WalletProvider'
import { ReviewModal } from './ReviewModal'
import {
  DEFAULT_SETTINGS,
  manualSlippageBps,
  recipientPending,
  resolvedReceiver,
  validForSeconds,
  type SwapSettings,
} from './settings'
import { SwapSettingsPanel } from './SwapSettings'
import { TokenSelect } from './TokenSelect'
import { useNativePrice, useQuote } from './useSwap'

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
  const [buyAmount, setBuyAmount] = useState('')
  const [limitBuyAmount, setLimitBuyAmount] = useState('')
  // Which side the user fixed: 'sell' = exact-sell (the SDK quotes the buy), 'buy' =
  // exact-buy (the SDK quotes the sell). Editing a field sets it; market mode only.
  const [exactSide, setExactSide] = useState<Side>('sell')
  const [settings, setSettings] = useState<SwapSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    setExactSide('sell')
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

  // Native sells go through eth-flow, which is sell-exact, so buy-side is offered
  // only for ERC-20 sells. `side` is the effective exact side after that guard.
  const canBuySide = mode === 'market' && sellToken !== undefined && !sellToken.native
  const side: Side = canBuySide ? exactSide : 'sell'

  // Resolve the settings into order knobs once. Auto leaves `slippageBps` unset so
  // the SDK applies (and reports) its own suggestion; the lifetime and any custom
  // recipient flow into every quote so the displayed amounts already reflect them.
  const slippageParam = manualSlippageBps(settings)
  const receiver = resolvedReceiver(settings)
  const validFor = validForSeconds(settings, mode)
  const recipientIncomplete = recipientPending(settings)

  // The fixed side drives the quote: its token + amount become `kind` + `amount`.
  const exactToken = side === 'sell' ? sellToken : buyToken
  const exactAmount = side === 'sell' ? sellAmount : buyAmount

  const swapParams: SwapParametersInput | null = useMemo(() => {
    if (mode !== 'market' || !sellToken || !buyToken || account === undefined || !exactToken) return null
    if (!isPositiveAmount(exactAmount, exactToken.decimals)) return null
    // The SDK requires an owner for quote-only flows; it builds the order-to-sign
    // payload for the connected account.
    return {
      kind: side,
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      amount: toAtoms(exactAmount, exactToken.decimals),
      validFor,
      ...(slippageParam !== undefined ? { slippageBps: slippageParam } : {}),
      ...(receiver !== undefined ? { receiver } : {}),
      owner: account,
    }
  }, [mode, sellToken, buyToken, account, side, exactToken, exactAmount, validFor, slippageParam, receiver])

  // Pause quote polling while the review modal is open so the amounts cannot
  // change between the user reading them and signing.
  const quote = useQuote(chainId, swapParams, !reviewing)
  const amounts = quote.data?.amountsAndCosts
  const sellPrice = useNativePrice(chainId, sellToken?.address)
  const buyPrice = useNativePrice(chainId, buyToken?.address)

  // Price impact: the value given up versus the native-price mid, as a clean
  // dimensionless ratio (the native units cancel). A thin testnet price feed can
  // produce implausible values, so it is shown only when both prices load and the
  // result is sane — the minimum-received bound still protects the trade either way.
  const sellValueNative =
    amounts && sellPrice.data !== undefined
      ? Number(amounts.afterPartnerFees.sellAmount) * sellPrice.data
      : undefined
  const buyValueNative =
    amounts && buyPrice.data !== undefined
      ? Number(amounts.afterPartnerFees.buyAmount) * buyPrice.data
      : undefined
  const rawPriceImpact =
    sellValueNative !== undefined && buyValueNative !== undefined && sellValueNative > 0
      ? 1 - buyValueNative / sellValueNative
      : undefined
  const priceImpact =
    rawPriceImpact !== undefined && Math.abs(rawPriceImpact) < 0.5 ? rawPriceImpact : undefined

  // The non-fixed field shows the SDK's estimate (after fees, before the slippage buffer).
  const estimatedSell = amounts && sellToken ? formatAmount(amounts.afterPartnerFees.sellAmount, sellToken.decimals) : ''
  const estimatedBuy = amounts && buyToken ? formatAmount(amounts.afterPartnerFees.buyAmount, buyToken.decimals) : ''
  const sellFieldValue = mode === 'limit' ? sellAmount : side === 'sell' ? sellAmount : estimatedSell
  const buyFieldValue = mode === 'limit' ? limitBuyAmount : side === 'buy' ? buyAmount : estimatedBuy

  function onSellInput(value: string) {
    setSellAmount(value)
    if (mode === 'market') setExactSide('sell')
  }
  function onBuyInput(value: string) {
    if (mode === 'limit') {
      setLimitBuyAmount(value)
    } else {
      setBuyAmount(value)
      setExactSide('buy')
    }
  }

  // What we show as the slippage: the manual value, or the SDK's Auto suggestion.
  const shownSlippageBps = slippageParam ?? quote.data?.suggestedSlippageBps

  function flip() {
    setSellSel(buyToken)
    setBuySel(sellToken)
    setSellAmount('')
    setBuyAmount('')
    setLimitBuyAmount('')
    setExactSide('sell')
  }

  const amountEntered = isPositiveAmount(exactAmount, exactToken?.decimals ?? 18)

  // The sell the order will actually spend: the exact amount when selling, the
  // quoted maximum (post-slippage) when buying. Drives the balance check + approval.
  const orderSellAtoms =
    mode !== 'market'
      ? undefined
      : side === 'sell'
        ? amountEntered && sellToken
          ? toAtoms(sellAmount, sellToken.decimals)
          : undefined
        : amounts?.amountsToSign.sellAmount

  // Require the balance only for a market swap. A limit order is a standing intent
  // the user may fund later, so it is allowed above the current balance.
  const insufficientBalance =
    orderSellAtoms !== undefined && sellBalance !== undefined && BigInt(orderSellAtoms) > BigInt(sellBalance)

  const limitReady =
    mode === 'limit' && amountEntered && isPositiveAmount(limitBuyAmount, buyToken?.decimals ?? 18)
  const marketReady = mode === 'market' && Boolean(quote.data)
  const canReview =
    account !== undefined &&
    !wrongNetwork &&
    !insufficientBalance &&
    !recipientIncomplete &&
    (marketReady || limitReady)

  // The slippage-protected bound flips with the side: a floor on the buy when
  // selling, a ceiling on the sell when buying.
  const bound =
    amounts && sellToken && buyToken
      ? side === 'sell'
        ? {
            label: 'Minimum received',
            amount: formatAmount(amounts.afterSlippage.buyAmount, buyToken.decimals),
            symbol: buyToken.symbol,
          }
        : {
            label: 'Maximum sold',
            amount: formatAmount(amounts.afterSlippage.sellAmount, sellToken.decimals),
            symbol: sellToken.symbol,
          }
      : null

  return (
    <section className="card swap-card">
      <div className="card-head">
        <div className="tabs">
          <button type="button" className={mode === 'market' ? 'tab tab-active' : 'tab'} onClick={() => setMode('market')}>
            Swap
          </button>
          <button type="button" className={mode === 'limit' ? 'tab tab-active' : 'tab'} onClick={() => setMode('limit')}>
            Limit
          </button>
        </div>
        <button
          type="button"
          className="icon-btn settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Swap settings"
        >
          ⚙
        </button>
      </div>

      <TokenField
        label="Sell"
        token={sellToken}
        amount={sellFieldValue}
        editable
        loading={mode === 'market' && side === 'buy' && quote.isFetching && !quote.data}
        balanceAtoms={sellBalance}
        onMax={setMax}
        onAmount={onSellInput}
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
        amount={buyFieldValue}
        editable={mode === 'limit' || canBuySide}
        loading={mode === 'market' && side === 'sell' && quote.isFetching && !quote.data}
        balanceAtoms={buyBalance}
        onAmount={onBuyInput}
        onPick={() => setPicking('buy')}
      />

      {settings.recipient.enabled ? (
        <div className="recipient-field">
          <span className="token-field-label">Recipient</span>
          <input
            className="recipient-input"
            placeholder="0x… wallet address"
            autoComplete="off"
            spellCheck={false}
            value={settings.recipient.address}
            onChange={(event) =>
              setSettings({ ...settings, recipient: { ...settings.recipient, address: event.target.value } })
            }
          />
          {settings.recipient.address.trim() !== '' && !isAddress(settings.recipient.address.trim()) ? (
            <p className="error-text">Enter a valid wallet address.</p>
          ) : null}
        </div>
      ) : null}

      {mode === 'market' && quote.isError ? (
        <p className="error-text">{toUiError(quote.error).detail}</p>
      ) : null}

      {mode === 'market' && quote.data && bound && sellToken ? (
        <QuoteSummary
          boundLabel={bound.label}
          boundAmount={bound.amount}
          boundSymbol={bound.symbol}
          networkCost={formatAmount(
            quote.data.amountsAndCosts.costs.networkFee.amountInSellCurrency,
            sellToken.decimals,
            6,
          )}
          sellSymbol={sellToken.symbol}
          priceImpact={priceImpact}
          slippageBps={shownSlippageBps}
          slippageAuto={settings.slippage.mode === 'auto'}
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
                : recipientIncomplete
                  ? 'Enter a valid recipient'
                  : mode === 'market' && quote.isFetching && !quote.data
                    ? 'Fetching quote…'
                    : 'Review order'}
      </Button>

      <SwapSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode={mode}
        settings={settings}
        onChange={setSettings}
        suggestedSlippageBps={quote.data?.suggestedSlippageBps}
      />

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
          side={side}
          sellToken={sellToken}
          buyToken={buyToken}
          sellAmount={sellAmount}
          buyAmount={buyAmount}
          limitBuyAmount={limitBuyAmount}
          settings={settings}
          quote={mode === 'market' ? quote.data : undefined}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false)
            setSellAmount('')
            setBuyAmount('')
            setLimitBuyAmount('')
            setExactSide('sell')
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
  boundLabel: string
  boundAmount: string
  boundSymbol: string
  networkCost: string
  sellSymbol: string
  priceImpact: number | undefined
  slippageBps: number | undefined
  slippageAuto: boolean
  expiration: string
}

function QuoteSummary({
  boundLabel,
  boundAmount,
  boundSymbol,
  networkCost,
  sellSymbol,
  priceImpact,
  slippageBps,
  slippageAuto,
  expiration,
}: QuoteSummaryProps) {
  return (
    <dl className="quote-summary">
      <div>
        <dt>{boundLabel}</dt>
        <dd>
          {boundAmount} {boundSymbol}
        </dd>
      </div>
      <div>
        <dt>Network cost</dt>
        <dd>
          {networkCost} {sellSymbol}
        </dd>
      </div>
      {priceImpact !== undefined ? (
        <div>
          <dt>Price impact</dt>
          <dd className={priceImpact > 0.05 ? 'impact-warn' : undefined}>{(priceImpact * -100).toFixed(2)}%</dd>
        </div>
      ) : null}
      <div>
        <dt>Slippage tolerance{slippageAuto ? ' (auto)' : ''}</dt>
        <dd>{slippageBps !== undefined ? `${(slippageBps / 100).toFixed(2)}%` : '—'}</dd>
      </div>
      <div>
        <dt>Quote expires</dt>
        <dd>{new Date(expiration).toLocaleTimeString()}</dd>
      </div>
    </dl>
  )
}
