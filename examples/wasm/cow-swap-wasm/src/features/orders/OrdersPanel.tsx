import { useMemo, useState } from 'react'

import type { Order, OrderStatus } from '@symbiome-forge/cow-sdk-wasm/trading'

import { chainMeta, cowExplorerOrderUrl } from '../../chains/registry'
import { formatAmount, fromAtoms } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Cow } from '../../ui/Cow'
import { Badge, Button, Spinner } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/toast'
import { useWallet } from '../../wallet/WalletProvider'
import {
  useCancelOrders,
  useCompetition,
  useInvalidateSurplusOnFill,
  useOrders,
  useTotalSurplus,
  useTrades,
} from './orders'
import { useSubmittedTwaps, type SubmittedTwap } from '../twap/store'

const STATUS: Record<OrderStatus, { label: string; tone: 'pending' | 'info' | 'success' | 'warning' | 'danger' }> = {
  open: { label: 'Open', tone: 'pending' },
  presignaturePending: { label: 'Signing', tone: 'info' },
  fulfilled: { label: 'Filled', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

type Tab = 'open' | 'history'

// An order is still live (and cancellable) while open or awaiting its pre-signature.
function isOpen(order: Order): boolean {
  return order.status === 'open' || order.status === 'presignaturePending'
}

function symbolFor(map: Map<string, TokenInfo>, address: string): string {
  return map.get(address.toLowerCase())?.symbol ?? `${address.slice(0, 6)}…`
}

function decimalsFor(map: Map<string, TokenInfo>, address: string): number {
  return map.get(address.toLowerCase())?.decimals ?? 18
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function trimNum(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Number(value.toFixed(6)).toString()
}

// The order's limit rate: buy tokens per 1 sell token (what "Limit price" shows).
function rateOf(sellAmount: string, buyAmount: string, sellDec: number, buyDec: number): number {
  const sell = Number(fromAtoms(sellAmount, sellDec))
  const buy = Number(fromAtoms(buyAmount, buyDec))
  return sell > 0 ? buy / sell : NaN
}

// Filled fraction (0–1), sell-side, so it caps at 100% regardless of surplus.
function filledPercent(order: Order): number {
  const total = BigInt(order.sellAmount)
  if (total === 0n) return 0
  const done = order.executedSellAmount ? BigInt(order.executedSellAmount) : 0n
  return Math.min(100, Number((done * 10_000n) / total) / 100)
}

function fmtWhen(date: Date): string {
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function OrdersPanel() {
  const { chainId, account } = useWallet()
  const orders = useOrders(chainId, account)
  const surplus = useTotalSurplus(chainId, account)
  useInvalidateSurplusOnFill(chainId, account, orders.data)
  const tokenList = useTokenList(chainId)
  const cancel = useCancelOrders()
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [receipt, setReceipt] = useState<Order>()
  // History filters (client-side): by status + token symbol/address.
  const [historyFilter, setHistoryFilter] = useState<'all' | 'filled' | 'cancelled' | 'expired'>('all')
  const [tokenQuery, setTokenQuery] = useState('')

  const tokenMap = useMemo(() => {
    const map = new Map<string, TokenInfo>()
    for (const token of tokenList.data ?? []) map.set(token.address, token)
    return map
  }, [tokenList.data])

  // TWAPs created in this session, shown immediately while the watch tower starts
  // posting their parts to the order book (each part then appears as its own row).
  const submittedTwaps = useSubmittedTwaps()
  const myTwaps = useMemo(
    () =>
      submittedTwaps.filter(
        (twap) => twap.chainId === chainId && twap.account.toLowerCase() === (account ?? '').toLowerCase(),
      ),
    [submittedTwaps, chainId, account],
  )

  if (account === undefined) {
    return (
      <section className="card orders-card">
        <h2>Activity</h2>
        <div className="empty-guide">
          <Cow mood="happy" size={64} blink />
          <p className="muted">Connect a wallet to see your orders, fills, and surplus.</p>
        </div>
      </section>
    )
  }

  const all = orders.data ?? []
  const open = all.filter(isOpen)
  const history = all.filter((order) => !isOpen(order))
  // Filter history client-side: by status, then by a token symbol/address
  // substring across both legs.
  const query = tokenQuery.trim().toLowerCase()
  const filteredHistory = history.filter((order) => {
    if (historyFilter === 'filled' && order.status !== 'fulfilled') return false
    if (historyFilter === 'cancelled' && order.status !== 'cancelled') return false
    if (historyFilter === 'expired' && order.status !== 'expired') return false
    if (query !== '') {
      const haystack =
        `${symbolFor(tokenMap, order.sellToken)} ${symbolFor(tokenMap, order.buyToken)} ${order.sellToken} ${order.buyToken}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  const shown = tab === 'open' ? open : filteredHistory
  // Selections are kept as UIDs; an order that leaves the open set is simply ignored.
  const selectedUids = open.filter((order) => selected.has(order.uid)).map((order) => order.uid)

  const surplusAtoms = surplus.data?.totalSurplus
  const native = chainId !== undefined ? chainMeta(chainId)?.nativeSymbol : undefined
  const showTwaps = tab === 'open' && myTwaps.length > 0
  const hasRows = shown.length > 0 || showTwaps

  function toggleSelect(uid: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function cancelSelected() {
    if (selectedUids.length === 0) return
    cancel.mutate(selectedUids, {
      onSuccess: () => {
        setSelected(new Set())
        toast.push({
          tone: 'info',
          title: `Cancellation submitted for ${selectedUids.length} order${selectedUids.length > 1 ? 's' : ''}`,
        })
      },
      onError: (error) => {
        const ui = toUiError(error)
        toast.push({ tone: ui.userRejected ? 'info' : 'danger', title: ui.title, detail: ui.detail })
      },
    })
  }

  return (
    <section className="card orders-card">
      <div className="orders-head">
        <h2>Activity</h2>
        {orders.isFetching ? <Spinner small /> : null}
      </div>

      {surplusAtoms && BigInt(surplusAtoms) > 0n ? (
        <div className="surplus-banner">
          <span>Total surplus CoW has captured for you</span>
          <strong>
            +{formatAmount(surplusAtoms, 18, 6)} {native}
          </strong>
        </div>
      ) : null}

      <div className="orders-tabbar">
        <div className="tabs orders-tabs">
          <button type="button" className={tab === 'open' ? 'tab tab-active' : 'tab'} onClick={() => setTab('open')}>
            Open ({open.length + myTwaps.length})
          </button>
          <button
            type="button"
            className={tab === 'history' ? 'tab tab-active' : 'tab'}
            onClick={() => setTab('history')}
          >
            Orders history ({history.length})
          </button>
        </div>
        {tab === 'history' ? (
          <div className="orders-filters">
            <Select
              value={historyFilter}
              options={[
                { value: 'all', label: 'All orders' },
                { value: 'filled', label: 'Filled orders' },
                { value: 'cancelled', label: 'Cancelled orders' },
                { value: 'expired', label: 'Expired orders' },
              ]}
              onChange={(value) => setHistoryFilter(value as 'all' | 'filled' | 'cancelled' | 'expired')}
              ariaLabel="Filter orders by status"
            />
            <input
              className="orders-search"
              type="search"
              placeholder="Token symbol, address"
              value={tokenQuery}
              onChange={(event) => setTokenQuery(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      {tab === 'open' && selectedUids.length > 0 ? (
        <div className="bulk-bar">
          <span>{selectedUids.length} selected</span>
          <Button variant="ghost" onClick={cancelSelected} loading={cancel.isPending}>
            Cancel selected
          </Button>
        </div>
      ) : null}

      {hasRows ? (
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                {tab === 'open' ? <th className="col-select" aria-label="Select" /> : null}
                <th>Sell &rarr; Buy</th>
                <th>Limit price</th>
                <th>Filled</th>
                <th>Status</th>
                <th>{tab === 'open' ? 'Expiration' : 'Created'}</th>
                <th className="col-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {showTwaps ? myTwaps.map((twap) => <TwapRow key={twap.orderId} twap={twap} tokenMap={tokenMap} />) : null}
              {shown.map((order) => (
                <OrderRow
                  key={order.uid}
                  order={order}
                  tokenMap={tokenMap}
                  chainId={chainId}
                  tab={tab}
                  selected={selected.has(order.uid)}
                  onToggle={() => toggleSelect(order.uid)}
                  onReceipt={() => setReceipt(order)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-guide">
          <Cow mood={tab === 'open' ? 'thinking' : 'happy'} size={48} />
          <p className="muted">
            {tab === 'open'
              ? 'No open orders yet — your live trades will appear here.'
              : history.length > 0
                ? 'No orders match your filter.'
                : 'No past orders yet.'}
          </p>
        </div>
      )}

      {receipt ? (
        <ReceiptModal order={receipt} tokenMap={tokenMap} chainId={chainId} onClose={() => setReceipt(undefined)} />
      ) : null}
    </section>
  )
}

// A just-created TWAP parent. Its equal parts post to the order book on schedule and
// then appear as their own rows; this row shows the parent immediately after submit.
function TwapRow({ twap, tokenMap }: { twap: SubmittedTwap; tokenMap: Map<string, TokenInfo> }) {
  const sellSymbol = symbolFor(tokenMap, twap.sellToken)
  const buySymbol = symbolFor(tokenMap, twap.buyToken)
  const sellDec = decimalsFor(tokenMap, twap.sellToken)
  const buyDec = decimalsFor(tokenMap, twap.buyToken)
  const sell = formatAmount(twap.sellAmount, sellDec, 4)
  const buy = formatAmount(twap.buyAmount, buyDec, 4)
  const rate = rateOf(twap.sellAmount, twap.buyAmount, sellDec, buyDec)
  return (
    <tr className="order-row">
      <td className="col-select" />
      <td className="order-pair">
        {sell} {sellSymbol} <span className="arrow">&rarr;</span> {buy} {buySymbol}
      </td>
      <td className="order-rate">
        {trimNum(rate)} {buySymbol}
        <span className="muted"> /{sellSymbol}</span>
      </td>
      <td className="muted">—</td>
      <td>
        <Badge tone="info">TWAP · {twap.numberOfParts} parts</Badge>
      </td>
      <td className="muted">Scheduling…</td>
      <td className="col-actions muted">In Safe</td>
    </tr>
  )
}

interface OrderRowProps {
  order: Order
  tokenMap: Map<string, TokenInfo>
  chainId: number | undefined
  tab: Tab
  selected: boolean
  onToggle: () => void
  onReceipt: () => void
}

function OrderRow({ order, tokenMap, chainId, tab, selected, onToggle, onReceipt }: OrderRowProps) {
  const status = STATUS[order.status]
  const sellSymbol = symbolFor(tokenMap, order.sellToken)
  const buySymbol = symbolFor(tokenMap, order.buyToken)
  const sellDec = decimalsFor(tokenMap, order.sellToken)
  const buyDec = decimalsFor(tokenMap, order.buyToken)
  const sell = formatAmount(order.sellAmount, sellDec, 4)
  // Show the order's buy amount (its limit/minimum) until it fills, then the executed amount.
  const executedBuy =
    order.executedBuyAmount && BigInt(order.executedBuyAmount) > 0n ? order.executedBuyAmount : undefined
  const buy = formatAmount(executedBuy ?? order.buyAmount, buyDec, 4)
  const rate = rateOf(order.sellAmount, order.buyAmount, sellDec, buyDec)
  const filled = Math.round(filledPercent(order))
  const when = tab === 'open' ? new Date(order.validTo * 1000) : new Date(order.creationDate)

  return (
    <tr className="order-row">
      {tab === 'open' ? (
        <td className="col-select">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Select order to cancel" />
        </td>
      ) : null}
      <td className="order-pair">
        {sell} {sellSymbol} <span className="arrow">&rarr;</span> {buy} {buySymbol}
      </td>
      <td className="order-rate">
        {trimNum(rate)} {buySymbol}
        <span className="muted"> /{sellSymbol}</span>
      </td>
      <td className="order-filled">
        <span className="fill-bar">
          <span className="fill-bar-on" style={{ width: `${filled}%` }} />
        </span>
        <span className="fill-pct">{filled}%</span>
      </td>
      <td>
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      <td className="order-when">{fmtWhen(when)}</td>
      <td className="col-actions">
        {chainId !== undefined ? (
          <a
            className="link"
            href={cowExplorerOrderUrl(chainId, order.uid)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in CoW Explorer"
          >
            ↗
          </a>
        ) : null}
        <button type="button" className="link" onClick={onReceipt}>
          Details
        </button>
      </td>
    </tr>
  )
}

interface ReceiptModalProps {
  order: Order
  tokenMap: Map<string, TokenInfo>
  chainId: number | undefined
  onClose: () => void
}

function ReceiptModal({ order, tokenMap, chainId, onClose }: ReceiptModalProps) {
  const trades = useTrades(chainId, order.uid, true)
  const competition = useCompetition(chainId, order.uid, true)
  const status = STATUS[order.status]
  const sellSymbol = symbolFor(tokenMap, order.sellToken)
  const buySymbol = symbolFor(tokenMap, order.buyToken)
  const sellDec = decimalsFor(tokenMap, order.sellToken)
  const buyDec = decimalsFor(tokenMap, order.buyToken)
  const customReceiver =
    order.receiver && order.receiver.toLowerCase() !== order.owner.toLowerCase() ? order.receiver : undefined
  // Executed (effective) price, shown once the order has filled.
  const executedPrice =
    order.executedSellAmount && order.executedBuyAmount && BigInt(order.executedSellAmount) > 0n
      ? rateOf(order.executedSellAmount, order.executedBuyAmount, sellDec, buyDec)
      : undefined

  return (
    <Modal open onClose={onClose} title="Order receipt">
      <dl className="review-details">
        <div>
          <dt>Status</dt>
          <dd>
            <Badge tone={status.tone}>{status.label}</Badge>
          </dd>
        </div>
        <div>
          <dt>Sell</dt>
          <dd>
            {formatAmount(order.sellAmount, sellDec, 6)} {sellSymbol}
          </dd>
        </div>
        <div>
          <dt>Buy</dt>
          <dd>
            {formatAmount(order.buyAmount, buyDec, 6)} {buySymbol}
          </dd>
        </div>
        <div>
          <dt>Limit price</dt>
          <dd>
            {trimNum(rateOf(order.sellAmount, order.buyAmount, sellDec, buyDec))} {buySymbol} / {sellSymbol}
          </dd>
        </div>
        {executedPrice !== undefined ? (
          <div>
            <dt>Execution price</dt>
            <dd>
              {trimNum(executedPrice)} {buySymbol} / {sellSymbol}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Valid until</dt>
          <dd>{new Date(order.validTo * 1000).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Partial fills</dt>
          <dd>{order.partiallyFillable ? 'Allowed' : 'Fill or kill'}</dd>
        </div>
        {customReceiver ? (
          <div>
            <dt>Recipient</dt>
            <dd>{shortAddress(customReceiver)}</dd>
          </div>
        ) : null}
      </dl>

      <h4 className="receipt-fills-head">Fills</h4>
      {trades.isLoading ? (
        <Spinner small />
      ) : trades.data && trades.data.length > 0 ? (
        <ul className="trade-list">
          {trades.data.map((trade) => (
            <li key={`${trade.blockNumber}-${trade.logIndex}`}>
              {formatAmount(trade.sellAmount, sellDec, 6)} {sellSymbol} <span className="arrow">&rarr;</span>{' '}
              {formatAmount(trade.buyAmount, buyDec, 6)} {buySymbol}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No fills yet.</p>
      )}

      <h4 className="receipt-fills-head">Solver competition</h4>
      {competition.isLoading ? (
        <Spinner small />
      ) : competition.data ? (
        <>
          <p className="muted">Status: {competition.data.type}</p>
          {competition.data.value && competition.data.value.length > 0 ? (
            <ul className="trade-list">
              {competition.data.value.map((execution, index) => (
                <li key={`${execution.solver}-${index}`} className="mono">
                  {execution.solver}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted">No competition data yet.</p>
      )}
    </Modal>
  )
}
