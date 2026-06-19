import { useMemo, useState } from 'react'

import type { OrderDto, OrderStatusDto } from '@symbiome-forge/cow-sdk-wasm/trading'

import { chainMeta, cowExplorerOrderUrl } from '../../chains/registry'
import { formatAmount } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Cow } from '../../ui/Cow'
import { Badge, Button, Spinner } from '../../ui/primitives'
import { Modal } from '../../ui/Modal'
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

const STATUS: Record<OrderStatusDto, { label: string; tone: 'pending' | 'info' | 'success' | 'warning' | 'danger' }> = {
  open: { label: 'Open', tone: 'pending' },
  presignaturePending: { label: 'Signing', tone: 'info' },
  fulfilled: { label: 'Filled', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

type Tab = 'open' | 'history'

// An order is still live (and cancellable) while open or awaiting its pre-signature.
function isOpen(order: OrderDto): boolean {
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
  const [receipt, setReceipt] = useState<OrderDto>()

  const tokenMap = useMemo(() => {
    const map = new Map<string, TokenInfo>()
    for (const token of tokenList.data ?? []) map.set(token.address, token)
    return map
  }, [tokenList.data])

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
  const shown = tab === 'open' ? open : history
  // Selections are kept as UIDs; an order that leaves the open set is simply ignored.
  const selectedUids = open.filter((order) => selected.has(order.uid)).map((order) => order.uid)

  const surplusAtoms = surplus.data?.totalSurplus
  const native = chainId !== undefined ? chainMeta(chainId)?.nativeSymbol : undefined

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

      <div className="tabs orders-tabs">
        <button type="button" className={tab === 'open' ? 'tab tab-active' : 'tab'} onClick={() => setTab('open')}>
          Open ({open.length})
        </button>
        <button type="button" className={tab === 'history' ? 'tab tab-active' : 'tab'} onClick={() => setTab('history')}>
          History ({history.length})
        </button>
      </div>

      {tab === 'open' && selectedUids.length > 0 ? (
        <div className="bulk-bar">
          <span>{selectedUids.length} selected</span>
          <Button variant="ghost" onClick={cancelSelected} loading={cancel.isPending}>
            Cancel selected
          </Button>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul className="order-list">
          {shown.map((order) => (
            <OrderRow
              key={order.uid}
              order={order}
              tokenMap={tokenMap}
              chainId={chainId}
              selectable={tab === 'open'}
              selected={selected.has(order.uid)}
              onToggle={() => toggleSelect(order.uid)}
              onReceipt={() => setReceipt(order)}
            />
          ))}
        </ul>
      ) : (
        <div className="empty-guide">
          <Cow mood={tab === 'open' ? 'thinking' : 'happy'} size={48} />
          <p className="muted">
            {tab === 'open' ? 'No open orders yet — your live trades will appear here.' : 'No past orders yet.'}
          </p>
        </div>
      )}

      {receipt ? (
        <ReceiptModal order={receipt} tokenMap={tokenMap} chainId={chainId} onClose={() => setReceipt(undefined)} />
      ) : null}
    </section>
  )
}

interface OrderRowProps {
  order: OrderDto
  tokenMap: Map<string, TokenInfo>
  chainId: number | undefined
  selectable: boolean
  selected: boolean
  onToggle: () => void
  onReceipt: () => void
}

function OrderRow({ order, tokenMap, chainId, selectable, selected, onToggle, onReceipt }: OrderRowProps) {
  const [showSolvers, setShowSolvers] = useState(false)
  const competition = useCompetition(chainId, order.uid, showSolvers)

  const status = STATUS[order.status]
  const sellSymbol = symbolFor(tokenMap, order.sellToken)
  const buySymbol = symbolFor(tokenMap, order.buyToken)
  const sell = formatAmount(order.sellAmount, decimalsFor(tokenMap, order.sellToken), 4)
  // `executedBuyAmount` is "0" until the order fills; show the order's buy amount
  // (the limit / minimum) until then, and the executed amount once it settles.
  const executedBuy =
    order.executedBuyAmount && BigInt(order.executedBuyAmount) > 0n ? order.executedBuyAmount : undefined
  const buy = formatAmount(executedBuy ?? order.buyAmount, decimalsFor(tokenMap, order.buyToken), 4)

  return (
    <li className="order-row">
      <div className="order-main">
        {selectable ? (
          <input
            type="checkbox"
            className="order-check"
            checked={selected}
            onChange={onToggle}
            aria-label="Select order to cancel"
          />
        ) : null}
        <div className="order-pair">
          {sell} {sellSymbol} <span className="arrow">→</span> {buy} {buySymbol}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="order-actions">
        {chainId !== undefined ? (
          <a className="link" href={cowExplorerOrderUrl(chainId, order.uid)} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
        ) : null}
        <button type="button" className="link" onClick={() => setShowSolvers((value) => !value)}>
          {showSolvers ? 'Hide solvers' : 'Solvers'}
        </button>
        <button type="button" className="link" onClick={onReceipt}>
          Details
        </button>
      </div>

      {showSolvers ? (
        <div className="order-solvers">
          {competition.isLoading ? (
            <Spinner small />
          ) : competition.data ? (
            <>
              <span className="muted">Status: {competition.data.type}</span>
              {competition.data.value && competition.data.value.length > 0 ? (
                <ul>
                  {competition.data.value.map((execution, index) => (
                    <li key={`${execution.solver}-${index}`}>{execution.solver}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <span className="muted">No competition data yet.</span>
          )}
        </div>
      ) : null}
    </li>
  )
}

interface ReceiptModalProps {
  order: OrderDto
  tokenMap: Map<string, TokenInfo>
  chainId: number | undefined
  onClose: () => void
}

function ReceiptModal({ order, tokenMap, chainId, onClose }: ReceiptModalProps) {
  const trades = useTrades(chainId, order.uid, true)
  const status = STATUS[order.status]
  const sellSymbol = symbolFor(tokenMap, order.sellToken)
  const buySymbol = symbolFor(tokenMap, order.buyToken)
  const sellDec = decimalsFor(tokenMap, order.sellToken)
  const buyDec = decimalsFor(tokenMap, order.buyToken)
  const customReceiver =
    order.receiver && order.receiver.toLowerCase() !== order.owner.toLowerCase() ? order.receiver : undefined

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
              {formatAmount(trade.sellAmount, sellDec, 6)} {sellSymbol} <span className="arrow">→</span>{' '}
              {formatAmount(trade.buyAmount, buyDec, 6)} {buySymbol}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No fills yet.</p>
      )}
    </Modal>
  )
}
