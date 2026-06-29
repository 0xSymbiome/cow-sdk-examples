import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { isAddress, type Address, type PublicClient } from 'viem'

import type { TradeParams } from '@symbiome-forge/cow-sdk-wasm/trading'

import { isSupportedChain } from '../../chains/registry'
import { toUiError } from '../../lib/cow-errors'
import { formatAmount, fromAtoms, isPositiveAmount, toAtoms } from '../../lib/format'
import { useBalances, useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Cow } from '../../ui/Cow'
import { Help } from '../../ui/Help'
import { Button } from '../../ui/primitives'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/toast'
import { useWallet } from '../../wallet/WalletProvider'
import { recipientPending, resolvedReceiver, type SwapSettings } from '../swap/settings'
import { TokenField } from '../swap/TokenField'
import { TokenSelect } from '../swap/TokenSelect'
import { useQuote } from '../swap/useSwap'
import { createTwapOrder, isSmartContractWallet, type TwapResult } from '../../twap/twap'
import { recordTwap } from './store'

type Side = 'sell' | 'buy'

// Field help tooltips for the ? markers.
const TIP = {
  rate: 'This is the current market price, including the fee.',
  priceProtection:
    "Your TWAP order won't execute and is protected if the market price dips more than your set price protection.",
  parts: 'Your TWAP order will be split into this many parts, which will execute one by one.',
  partDuration:
    'The "Part duration" refers to the duration between each part of your TWAP order.\n\nChoosing a shorter time allows for faster execution of each part, potentially reducing price fluctuations. Striking the right balance is crucial for optimal execution.',
  sellPerPart: 'Estimated amount that will be sold in each part of the order.',
  buyPerPart: 'Estimated amount that you will receive from each part of the order.',
}

// Total-duration presets. The interval between parts (the order's `t`) is derived:
// t = totalDuration / numberOfParts. Starting at 1 hour keeps the derived part time
// above the 5-min floor at sensible part counts.
const DURATIONS: { key: string; label: string; seconds: number }[] = [
  { key: '1h', label: '1 hour', seconds: 60 * 60 },
  { key: '6h', label: '6 hours', seconds: 6 * 60 * 60 },
  { key: '12h', label: '12 hours', seconds: 12 * 60 * 60 },
  { key: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { key: '1w', label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { key: '1mo', label: '1 month', seconds: 30 * 24 * 60 * 60 },
]

// Each part must span at least 5 minutes.
const MIN_PART_SECONDS = 5 * 60

// The quote is only for the displayed rate and the buy floor; its lifetime does not
// bind the TWAP (whose horizon is the total duration), so a short window is fine.
const QUOTE_VALID_FOR_SECONDS = 30 * 60

function pickDefault(tokens: TokenInfo[], symbol: string): TokenInfo | undefined {
  return tokens.find((token) => token.symbol.toUpperCase() === symbol)
}

// Price protection (a percent string) as basis points, clamped to 99.99%. This is
// the slippage the quote applies, so `afterSlippage.buyAmount` is the buy floor.
function protectionBps(percent: string): number {
  const value = Number.parseFloat(percent)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(9_999, Math.round(value * 100))
}

interface TwapPanelProps {
  settings: SwapSettings
  onSettingsChange: (next: SwapSettings) => void
}

// A TWAP is a ComposableCoW conditional order: the SDK builds the on-chain
// authorization, the Safe submits it, and the watch tower posts each equal part on
// schedule. EIP-1271 authenticated, so the wallet must be a Safe (via WalletConnect).
export function TwapPanel({ settings, onSettingsChange }: TwapPanelProps) {
  const { account, chainId, walletClient, publicClient } = useWallet()
  const tokenList = useTokenList(chainId)
  const tokens = useMemo(() => tokenList.data ?? [], [tokenList.data])
  const toast = useToast()

  // Is the connected account a Safe (smart-contract wallet)? The TWAP gate.
  const safeCheck = useQuery({
    queryKey: ['is-safe', chainId, account],
    enabled: account !== undefined && Boolean(publicClient),
    queryFn: () => isSmartContractWallet(publicClient as PublicClient, account as Address),
  })

  const [sellSel, setSellSel] = useState<TokenInfo>()
  const [buySel, setBuySel] = useState<TokenInfo>()
  const [sellAmount, setSellAmount] = useState('')
  const [parts, setParts] = useState('2')
  const [durationKey, setDurationKey] = useState('1h')
  // Custom total duration (the "Custom" deadline option, entered as hours +
  // minutes), used when durationKey === 'custom'. The 5-min part floor below still
  // gates it.
  const [customHours, setCustomHours] = useState('0')
  const [customMinutes, setCustomMinutes] = useState('30')
  // Default price protection: 10% — the slippage a TWAP order carries unless the
  // user changes it.
  const [priceProtection, setPriceProtection] = useState('10')
  const [picking, setPicking] = useState<Side>()
  const [result, setResult] = useState<TwapResult>()

  const inList = (token: TokenInfo | undefined) =>
    token !== undefined &&
    tokens.some((candidate) => candidate.address === token.address && candidate.chainId === token.chainId)
  const sellToken = inList(sellSel)
    ? sellSel
    : (pickDefault(tokens, 'WETH') ?? tokens.find((token) => !token.native) ?? tokens[0])
  const buyToken = inList(buySel)
    ? buySel
    : (pickDefault(tokens, 'USDC') ??
      tokens.find((token) => token.address !== sellToken?.address) ??
      tokens[1])

  const selectedTokens = useMemo(
    () => [sellToken, buyToken].filter((token): token is TokenInfo => token !== undefined),
    [sellToken, buyToken],
  )
  const balances = useBalances(selectedTokens)
  const sellBalance = sellToken ? balances.data?.[sellToken.address] : undefined

  // Schedule maths: parts + total duration → interval `t`.
  const partsCount = Number.parseInt(parts, 10)
  const partsValid = Number.isInteger(partsCount) && partsCount >= 2
  const isCustomDuration = durationKey === 'custom'
  const customSpanSeconds =
    (Math.max(0, Number.parseInt(customHours, 10) || 0) * 60 +
      Math.max(0, Number.parseInt(customMinutes, 10) || 0)) *
    60
  const spanSeconds = isCustomDuration
    ? customSpanSeconds
    : (DURATIONS.find((d) => d.key === durationKey)?.seconds ?? 3_600)
  const tSeconds = partsValid ? Math.floor(spanSeconds / partsCount) : 0
  const scheduleValid = partsValid && tSeconds >= MIN_PART_SECONDS
  const ppBps = protectionBps(priceProtection)

  const amountValid = sellToken !== undefined && isPositiveAmount(sellAmount, sellToken.decimals)
  const nativeSell = sellToken?.native === true
  const sameToken = sellToken !== undefined && sellToken.address === buyToken?.address
  const wrongNetwork = chainId !== undefined && !isSupportedChain(chainId)
  const recipientIncomplete = recipientPending(settings)
  const receiver = resolvedReceiver(settings)

  const sellAtoms = amountValid && sellToken ? toAtoms(sellAmount, sellToken.decimals) : undefined
  const insufficientBalance =
    sellAtoms !== undefined && sellBalance !== undefined && BigInt(sellAtoms) > BigInt(sellBalance)

  // Quote the full sell amount with the price protection as slippage, so the SDK's
  // `afterSlippage.buyAmount` is exactly the buy floor we pass as the TWAP minimum.
  const quoteParams: TradeParams | null = useMemo(() => {
    if (!sellToken || !buyToken || account === undefined || sellToken.native || sellToken.address === buyToken.address)
      return null
    if (!isPositiveAmount(sellAmount, sellToken.decimals)) return null
    return {
      kind: 'sell',
      sellToken: sellToken.address as `0x${string}`,
      buyToken: buyToken.address as `0x${string}`,
      amount: toAtoms(sellAmount, sellToken.decimals),
      validFor: QUOTE_VALID_FOR_SECONDS,
      slippageBps: ppBps,
      owner: account,
    }
  }, [sellToken, buyToken, account, sellAmount, ppBps])
  const quote = useQuote(chainId, quoteParams)
  const amounts = quote.data?.amountsAndCosts
  const buyEstimateAtoms = amounts?.afterPartnerFees.buyAmount
  const buyMinAtoms = amounts?.afterSlippage.buyAmount
  const quoteReady = buyMinAtoms !== undefined

  // Derived display values.
  const buyEstimate = buyEstimateAtoms && buyToken ? formatAmount(buyEstimateAtoms, buyToken.decimals) : ''
  const rate =
    buyEstimateAtoms && buyToken && Number(sellAmount) > 0
      ? Number(fromAtoms(buyEstimateAtoms, buyToken.decimals)) / Number(sellAmount)
      : undefined
  const sellPerPart =
    sellAtoms && partsValid && sellToken
      ? formatAmount((BigInt(sellAtoms) / BigInt(partsCount)).toString(), sellToken.decimals, 6)
      : undefined
  const buyPerPart =
    buyMinAtoms && partsValid && buyToken
      ? formatAmount((BigInt(buyMinAtoms) / BigInt(partsCount)).toString(), buyToken.decimals, 6)
      : undefined
  // Show the floor the order will actually use: each part's minimum × the parts
  // (an exact multiple of the parts, matching the SDK's divisibility requirement).
  const buyMinTotal =
    buyMinAtoms && partsValid && buyToken
      ? formatAmount(
          ((BigInt(buyMinAtoms) / BigInt(partsCount)) * BigInt(partsCount)).toString(),
          buyToken.decimals,
          6,
        )
      : undefined
  const partLabel = partsValid ? ` (1/${partsCount})` : ''
  const totalDurationTip =
    `The "Total duration" is the duration it takes to execute all parts of your TWAP order.\n\n` +
    `For instance, your order consists of ${partsValid ? partsCount : 2} parts placed every ` +
    `${formatDuration(tSeconds || spanSeconds)}, the total time to complete the order is ` +
    `${formatDuration(spanSeconds)}. Each limit order remains open for ${formatDuration(tSeconds || spanSeconds)} ` +
    `until the next part becomes active.`

  const canCreate =
    !wrongNetwork &&
    amountValid &&
    !nativeSell &&
    partsValid &&
    scheduleValid &&
    !sameToken &&
    !recipientIncomplete &&
    !insufficientBalance &&
    quoteReady

  function setMax() {
    if (!sellToken || sellBalance === undefined) return
    setSellAmount(fromAtoms(sellBalance, sellToken.decimals))
  }
  function stepParts(dir: 1 | -1) {
    setParts(String(Math.max(2, (Number.isInteger(partsCount) ? partsCount : 2) + dir)))
  }
  function stepProtection(dir: 1 | -1) {
    const current = Number.parseFloat(priceProtection)
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + dir * 0.5)
    setPriceProtection(String(Number(next.toFixed(2))))
  }

  const create = useMutation<TwapResult, Error, void>({
    mutationFn: async () => {
      if (
        !walletClient ||
        !publicClient ||
        account === undefined ||
        chainId === undefined ||
        sellToken === undefined ||
        buyToken === undefined ||
        sellAtoms === undefined ||
        buyMinAtoms === undefined
      ) {
        throw new Error('Connect your Safe, enter an amount, and wait for the quote')
      }
      const created = await createTwapOrder({
        walletClient,
        publicClient,
        account,
        chainId,
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: sellAtoms,
        buyAmount: buyMinAtoms,
        numberOfParts: partsCount,
        timeBetweenParts: tSeconds,
        slippageBps: ppBps,
        ...(receiver !== undefined ? { receiver } : {}),
      })
      // Track it locally so the Activity panel shows it immediately, with the same
      // per-part-rounded totals the order uses.
      const partsBig = BigInt(partsCount)
      recordTwap({
        orderId: created.orderId,
        chainId,
        account,
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: ((BigInt(sellAtoms) / partsBig) * partsBig).toString(),
        buyAmount: ((BigInt(buyMinAtoms) / partsBig) * partsBig).toString(),
        numberOfParts: partsCount,
        createdAt: Date.now(),
      })
      return created
    },
    onSuccess: (twap) => {
      setResult(twap)
      toast.push({
        tone: 'success',
        title: 'TWAP submitted',
        detail: `Confirm it in your Safe — order ${twap.orderId.slice(0, 10)}….`,
      })
    },
    onError: (error) => {
      const ui = toUiError(error)
      toast.push({ tone: ui.userRejected ? 'info' : 'danger', title: ui.title, detail: ui.detail })
    },
  })

  if (account === undefined) {
    return (
      <div className="fee-warning">
        <Cow mood="happy" size={40} />
        <p>Connect a Safe to create a TWAP. Use the WalletConnect option and approve in your Safe.</p>
      </div>
    )
  }
  if (safeCheck.isLoading) {
    return <p className="review-foot">Checking wallet…</p>
  }
  if (safeCheck.data === false) {
    return (
      <div className="fee-warning">
        <Cow mood="worried" size={40} />
        <p>
          This is an externally owned account. TWAP orders are ComposableCoW conditional orders,
          authenticated through EIP-1271, so the owner must be a smart-contract <strong>Safe</strong>.
          Connect your Safe via WalletConnect and switch to it.
        </p>
      </div>
    )
  }

  return (
    <>
      <TokenField
        label="Sell (total)"
        token={sellToken}
        amount={sellAmount}
        editable
        balanceAtoms={sellBalance}
        onMax={setMax}
        onAmount={setSellAmount}
        onPick={() => setPicking('sell')}
      />

      <TokenField
        label="Buy (estimated total)"
        token={buyToken}
        amount={buyEstimate}
        editable={false}
        loading={quote.isFetching && !quote.data}
        onAmount={() => {}}
        onPick={() => setPicking('buy')}
      />

      <div className="twap-line">
        <span className="twap-line-label">
          Rate <Help text={TIP.rate} />
        </span>
        <span className="twap-line-value">
          {rate !== undefined && sellToken && buyToken
            ? `1 ${sellToken.symbol} = ${trimNum(rate)} ${buyToken.symbol}`
            : '—'}
        </span>
      </div>

      <div className="token-field">
        <span className="token-field-label">
          Price protection <Help text={TIP.priceProtection} />
        </span>
        <div className="token-field-row">
          <span className="twap-protected">
            {buyMinTotal && buyToken ? `${buyMinTotal} ${buyToken.symbol}` : '—'}
          </span>
          <input
            className="amount-input pp-input"
            inputMode="decimal"
            value={priceProtection}
            onChange={(event) => setPriceProtection(event.target.value.replace(/[^\d.]/g, ''))}
          />
          <span className="pp-unit">%</span>
          <Stepper onStep={stepProtection} />
        </div>
      </div>

      <div className="token-field">
        <span className="token-field-label">
          No. of parts <Help text={TIP.parts} />
        </span>
        <div className="token-field-row">
          <input
            className="amount-input"
            inputMode="numeric"
            value={parts}
            onChange={(event) => setParts(event.target.value.replace(/\D/g, ''))}
          />
          <Stepper onStep={stepParts} />
        </div>
      </div>

      <div className="twap-schedule">
        <label className="token-field">
          <span className="token-field-label">
            Total duration <Help text={totalDurationTip} />
          </span>
          <Select
            value={durationKey}
            options={[
              ...DURATIONS.map((option) => ({ value: option.key, label: option.label })),
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={setDurationKey}
            ariaLabel="Total duration"
          />
          {isCustomDuration ? (
            <div className="twap-custom-duration">
              <input
                className="amount-input"
                inputMode="numeric"
                aria-label="Custom duration hours"
                value={customHours}
                onChange={(event) => setCustomHours(event.target.value.replace(/\D/g, ''))}
              />
              <span className="pp-unit">h</span>
              <input
                className="amount-input"
                inputMode="numeric"
                aria-label="Custom duration minutes"
                value={customMinutes}
                onChange={(event) => setCustomMinutes(event.target.value.replace(/\D/g, ''))}
              />
              <span className="pp-unit">m</span>
            </div>
          ) : null}
        </label>
        <div className="token-field">
          <span className="token-field-label">
            Part duration <Help text={TIP.partDuration} />
          </span>
          <div className="twap-derived">{scheduleValid ? formatDuration(tSeconds) : '—'}</div>
        </div>
      </div>

      <div className="twap-schedule">
        <div className="token-field">
          <span className="token-field-label">
            Sell per part{partLabel} <Help text={TIP.sellPerPart} />
          </span>
          <div className="twap-derived">
            {sellPerPart && sellToken ? `${sellPerPart} ${sellToken.symbol}` : '—'}
          </div>
        </div>
        <div className="token-field">
          <span className="token-field-label">
            Buy per part{partLabel} <Help text={TIP.buyPerPart} />
          </span>
          <div className="twap-derived">
            {buyPerPart && buyToken ? `${buyPerPart} ${buyToken.symbol}` : '—'}
          </div>
        </div>
      </div>

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
              onSettingsChange({
                ...settings,
                recipient: { ...settings.recipient, address: event.target.value },
              })
            }
          />
          {settings.recipient.address.trim() !== '' && !isAddress(settings.recipient.address.trim()) ? (
            <p className="error-text">Enter a valid wallet address.</p>
          ) : null}
        </div>
      ) : null}

      {quote.isError && amountValid && !nativeSell && !sameToken ? (
        <p className="error-text">{toUiError(quote.error).detail}</p>
      ) : null}

      <Button
        variant="primary"
        className="swap-action"
        disabled={!canCreate || create.isPending}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        {wrongNetwork
          ? 'Unsupported network'
          : nativeSell
            ? `Wrap ${sellToken?.symbol ?? 'ETH'} to trade it`
            : sameToken
              ? 'Pick two different tokens'
              : !amountValid
                ? 'Enter the sell amount'
                : !partsValid
                  ? 'Use at least 2 parts'
                  : !scheduleValid
                    ? 'Increase duration or reduce parts'
                    : insufficientBalance
                      ? `Insufficient ${sellToken?.symbol ?? ''} balance`
                      : recipientIncomplete
                        ? 'Enter a valid recipient'
                        : !quoteReady
                          ? 'Fetching quote…'
                          : create.isPending
                            ? 'Submitting to Safe…'
                            : 'Create TWAP'}
      </Button>

      {result ? (
        <dl className="quote-summary">
          <div>
            <dt>Order id</dt>
            <dd className="mono">{result.orderId.slice(0, 18)}…</dd>
          </div>
          <div>
            <dt>Safe transaction</dt>
            <dd className="mono">{result.txHash.slice(0, 18)}…</dd>
          </div>
          <p className="review-foot">
            Confirm and execute it in your Safe. Once it lands, the watch tower posts each part to the
            order book — they appear under your Safe's orders as they go live.
          </p>
        </dl>
      ) : null}

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
    </>
  )
}

function Stepper({ onStep }: { onStep: (dir: 1 | -1) => void }) {
  return (
    <span className="stepper">
      <button type="button" className="stepper-btn" onClick={() => onStep(1)} aria-label="Increase">
        ▲
      </button>
      <button type="button" className="stepper-btn" onClick={() => onStep(-1)} aria-label="Decrease">
        ▼
      </button>
    </span>
  )
}

function trimNum(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Number(value.toFixed(6)).toString()
}

function formatDuration(seconds: number): string {
  const hours = seconds / 3600
  if (hours >= 24) return `${trimNum(hours / 24)} days`
  if (hours >= 1) return `${trimNum(hours)} hours`
  return `${trimNum(seconds / 60)} minutes`
}
