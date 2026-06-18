import { useMemo, useState } from 'react'

import type { OrderDto, OrderStatusDto } from '@symbiome-forge/cow-sdk-wasm/trading'

import { chainMeta, cowExplorerOrderUrl } from '../../chains/registry'
import { formatAmount } from '../../lib/format'
import { toUiError } from '../../lib/cow-errors'
import { useTokenList, type TokenInfo } from '../../tokens/tokens'
import { Badge, Button, Spinner } from '../../ui/primitives'
import { useToast } from '../../ui/toast'
import { useWallet } from '../../wallet/WalletProvider'
import { useCancelOrder, useCompetition, useOrders, useTotalSurplus } from './orders'

const STATUS: Record<OrderStatusDto, { label: string; tone: 'pending' | 'info' | 'success' | 'warning' | 'danger' }> = {
  open: { label: 'Open', tone: 'pending' },
  presignaturePending: { label: 'Signing', tone: 'info' },
  fulfilled: { label: 'Filled', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

export function OrdersPanel() {
  const { chainId, account } = useWallet()
  const orders = useOrders(chainId, account)
  const surplus = useTotalSurplus(chainId, account)
  const tokenList = useTokenList(chainId)

  const tokenMap = useMemo(() => {
    const map = new Map<string, TokenInfo>()
    for (const token of tokenList.data ?? []) map.set(token.address, token)
    return map
  }, [tokenList.data])

  if (account === undefined) {
    return (
      <section className="card orders-card">
        <h2>Activity</h2>
        <p className="muted">Connect a wallet to see your orders, fills, and surplus.</p>
      </section>
    )
  }

  const surplusAtoms = surplus.data?.totalSurplus
  const native = chainId !== undefined ? chainMeta(chainId)?.nativeSymbol : undefined

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

      {orders.data && orders.data.length > 0 ? (
        <ul className="order-list">
          {orders.data.map((order) => (
            <OrderRow key={order.uid} order={order} tokenMap={tokenMap} chainId={chainId} />
          ))}
        </ul>
      ) : (
        <p className="muted">No orders yet. Your swaps will appear here as they settle.</p>
      )}
    </section>
  )
}

function symbolFor(map: Map<string, TokenInfo>, address: string): string {
  return map.get(address.toLowerCase())?.symbol ?? `${address.slice(0, 6)}…`
}

function decimalsFor(map: Map<string, TokenInfo>, address: string): number {
  return map.get(address.toLowerCase())?.decimals ?? 18
}

function OrderRow({
  order,
  tokenMap,
  chainId,
}: {
  order: OrderDto
  tokenMap: Map<string, TokenInfo>
  chainId: number | undefined
}) {
  const cancel = useCancelOrder()
  const toast = useToast()
  const [showSolvers, setShowSolvers] = useState(false)
  const competition = useCompetition(chainId, order.uid, showSolvers)

  const status = STATUS[order.status]
  const cancellable = order.status === 'open' || order.status === 'presignaturePending'
  const sellSymbol = symbolFor(tokenMap, order.sellToken)
  const buySymbol = symbolFor(tokenMap, order.buyToken)
  const sell = formatAmount(order.sellAmount, decimalsFor(tokenMap, order.sellToken), 4)
  // `executedBuyAmount` is "0" until the order fills; show the order's buy amount
  // (the limit / minimum) until then, and the executed amount once it settles.
  const executedBuy =
    order.executedBuyAmount && BigInt(order.executedBuyAmount) > 0n
      ? order.executedBuyAmount
      : undefined
  const buy = formatAmount(executedBuy ?? order.buyAmount, decimalsFor(tokenMap, order.buyToken), 4)

  function onCancel() {
    cancel.mutate(order.uid, {
      onSuccess: () => toast.push({ tone: 'info', title: 'Cancellation submitted' }),
      onError: (error) => {
        const ui = toUiError(error)
        toast.push({ tone: ui.userRejected ? 'info' : 'danger', title: ui.title, detail: ui.detail })
      },
    })
  }

  return (
    <li className="order-row">
      <div className="order-main">
        <div className="order-pair">
          {sell} {sellSymbol} <span className="arrow">→</span> {buy} {buySymbol}
        </div>
        <Badge tone={status.tone}>{cancel.isPending ? 'Cancelling…' : status.label}</Badge>
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
        {cancellable ? (
          <Button variant="ghost" onClick={onCancel} loading={cancel.isPending}>
            Cancel
          </Button>
        ) : null}
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
