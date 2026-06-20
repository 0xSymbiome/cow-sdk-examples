import { useMemo, useState } from 'react'

import { wasmVersion, type QuoteResultsDto } from '@symbiome-forge/cow-sdk-wasm/trading'

import { chainMeta } from '../../chains/registry'
import { formatAmount } from '../../lib/format'
import { useTokenList, type TokenInfo } from '../../tokens/tokens'
import { useInspector } from './store'

// An optional drawer that surfaces the SDK's output for the *current quote* — the
// exact thing the wallet would sign next. The Summary tab resolves token symbols
// and decimals so the values read like the swap card; the JSON tab keeps the raw
// base-unit / address fidelity. It stays live and legible while a trade is in
// progress so the values can be inspected as they change.

type Tab = 'summary' | 'json'

function shorten(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function formatUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

export function InspectorDrawer() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('summary')
  // Read the SDK version once, after the wasm module is initialized.
  const [sdkVersion] = useState(() => wasmVersion())
  const { lastQuote, lastRetry } = useInspector()

  return (
    <>
      <button type="button" className="inspector-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide internals' : 'Under the hood'}
      </button>

      {open ? (
        <aside className="inspector" aria-label="SDK inspector">
          <header className="inspector-head">
            <strong>Under the hood</strong>
            <small>
              <a
                className="src-link"
                href={`https://www.npmjs.com/package/@symbiome-forge/cow-sdk-wasm/v/${sdkVersion}`}
                target="_blank"
                rel="noreferrer"
              >
                cow-sdk-wasm v{sdkVersion}
              </a>
              {' · '}
              <a
                className="src-link"
                href={`https://github.com/0xSymbiome/cow-rs/blob/v${sdkVersion}/crates/wasm/snapshots/facade/trading.d.ts`}
                target="_blank"
                rel="noreferrer"
              >
                trading flavor
              </a>
            </small>
          </header>

          {lastRetry ? (
            <p className="inspector-note">
              The SDK retried a transient orderbook failure — attempt {lastRetry.attempt}, backed off{' '}
              {lastRetry.delayMs} ms ({lastRetry.reason}). Failures decided on the request are never
              retried.
            </p>
          ) : null}

          {lastQuote ? (
            <>
              <div className="inspector-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'summary'}
                  className={tab === 'summary' ? 'inspector-tab inspector-tab-active' : 'inspector-tab'}
                  onClick={() => setTab('summary')}
                >
                  Summary
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'json'}
                  className={tab === 'json' ? 'inspector-tab inspector-tab-active' : 'inspector-tab'}
                  onClick={() => setTab('json')}
                >
                  JSON
                </button>
              </div>

              <p className="inspector-caption">
                The live quote — what your wallet would sign next.
              </p>

              {tab === 'summary' ? (
                <Summary quote={lastQuote} />
              ) : (
                <>
                  <h4>EIP-712 payload the wallet signs</h4>
                  <pre>{JSON.stringify(lastQuote.orderTypedData, null, 2)}</pre>
                  <h4>Amounts &amp; costs (raw base units)</h4>
                  <pre>{JSON.stringify(lastQuote.amountsAndCosts, null, 2)}</pre>
                </>
              )}
            </>
          ) : (
            <p className="muted">
              Request a quote to inspect the exact typed-data envelope and cost breakdown the SDK
              produces.
            </p>
          )}
        </aside>
      ) : null}
    </>
  )
}

function Summary({ quote }: { quote: QuoteResultsDto }) {
  const order = quote.orderToSign
  const amounts = quote.amountsAndCosts
  const domain = quote.orderTypedData.domain
  const chainId = domain.chainId
  const tokenList = useTokenList(chainId)

  const byAddress = useMemo(() => {
    const map = new Map<string, TokenInfo>()
    for (const token of tokenList.data ?? []) map.set(token.address.toLowerCase(), token)
    return map
  }, [tokenList.data])

  const sell = byAddress.get(order.sellToken.toLowerCase())
  const buy = byAddress.get(order.buyToken.toLowerCase())
  const chainName = chainMeta(chainId)?.label ?? String(chainId)

  const withSell = (atoms: string) =>
    sell ? `${formatAmount(atoms, sell.decimals)} ${sell.symbol}` : `${atoms} (base units)`
  const withBuy = (atoms: string) =>
    buy ? `${formatAmount(atoms, buy.decimals)} ${buy.symbol}` : `${atoms} (base units)`

  return (
    <div className="inspector-summary">
      <h4>Order to sign</h4>
      <dl>
        <Row label="Side" value={order.kind} />
        <Row label="Sell" value={withSell(order.sellAmount)} mono />
        <Row label="Buy (minimum)" value={withBuy(order.buyAmount)} mono strong />
        <Row label="Sell token" value={tokenLabel(sell, order.sellToken)} mono />
        <Row label="Buy token" value={tokenLabel(buy, order.buyToken)} mono />
        <Row label="Receiver" value={shorten(order.receiver)} mono />
        <Row label="Valid until" value={formatUnixSeconds(order.validTo)} />
        <Row label="App data" value={shorten(order.appData)} mono />
      </dl>

      <h4>Settlement</h4>
      <dl>
        <Row label="Protocol" value={`${domain.name} ${domain.version}`} />
        <Row label="Chain" value={`${chainName} (${chainId})`} />
        <Row label="Contract" value={shorten(domain.verifyingContract)} mono />
        <Row
          label="Quote id"
          value={quote.quoteResponse.id === undefined ? '—' : String(quote.quoteResponse.id)}
        />
        <Row label="Expires" value={new Date(quote.quoteResponse.expiration).toLocaleString()} />
      </dl>

      <h4>Price breakdown — you receive {buy?.symbol ?? 'the buy token'}</h4>
      <dl>
        <Row label="Before fees" value={withBuy(amounts.beforeAllFees.buyAmount)} mono />
        <Row label="− protocol fee" value={withBuy(amounts.afterProtocolFees.buyAmount)} mono />
        <Row label="− network cost" value={withBuy(amounts.afterNetworkCosts.buyAmount)} mono />
        <Row label="Minimum (signed)" value={withBuy(amounts.afterSlippage.buyAmount)} mono strong />
      </dl>
      <p className="inspector-note">
        This is a floor: you receive at least the minimum. Solvers compete to beat it at
        settlement, and any surplus is yours — so the executed amount is usually higher.
      </p>

      <h4>Costs</h4>
      <dl>
        <Row label="Network fee" value={withSell(amounts.costs.networkFee.amountInSellCurrency)} mono />
        <Row label="Protocol fee" value={`${amounts.costs.protocolFee.bps} bps`} />
        <Row label="Partner fee" value={`${amounts.costs.partnerFee.bps} bps`} />
      </dl>
    </div>
  )
}

function tokenLabel(token: TokenInfo | undefined, address: string): string {
  return token ? `${token.symbol} · ${shorten(address)}` : shorten(address)
}

function Row({
  label,
  value,
  mono,
  strong,
}: {
  label: string
  value: string
  mono?: boolean
  strong?: boolean
}) {
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd className={`${mono ? 'mono' : ''}${strong ? ' strong' : ''}`}>{value}</dd>
    </div>
  )
}
