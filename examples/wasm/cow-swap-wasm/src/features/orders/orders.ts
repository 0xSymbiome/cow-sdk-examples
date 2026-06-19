import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { Address } from 'viem'

import { signCancellationWithTypedDataSigner, type OrderDto } from '@symbiome-forge/cow-sdk-wasm/trading'

import { ORDER_POLL_IDLE_MS, ORDER_POLL_PENDING_MS } from '../../config'
import { getOrderBookClient } from '../../lib/cow'
import { typedDataSigner } from '../../lib/cow-callbacks'
import { useWallet } from '../../wallet/WalletProvider'

// An order is still settling only while open or awaiting its pre-signature.
function hasPendingOrder(orders: OrderDto[] | undefined): boolean {
  return orders?.some((o) => o.status === 'open' || o.status === 'presignaturePending') ?? false
}

/** The connected account's recent orders: re-polled quickly while an order is
 *  settling, and slowly otherwise. */
export function useOrders(chainId: number | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['orders', chainId, account],
    enabled: chainId !== undefined && account !== undefined,
    refetchInterval: (query) =>
      hasPendingOrder(query.state.data) ? ORDER_POLL_PENDING_MS : ORDER_POLL_IDLE_MS,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getOrders(account as Address)
        .then((envelope) => envelope.value),
  })
}

/** Cumulative surplus captured for the account. It only changes when an order
 *  fills, so it is fetched once and refreshed by invalidation, not a timer. */
export function useTotalSurplus(chainId: number | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['surplus', chainId, account],
    enabled: chainId !== undefined && account !== undefined,
    refetchInterval: false,
    staleTime: Infinity,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getTotalSurplus(account as Address)
        .then((envelope) => envelope.value),
  })
}

/** Refresh the cached surplus whenever a newly observed order has filled. */
export function useInvalidateSurplusOnFill(
  chainId: number | undefined,
  account: Address | undefined,
  orders: OrderDto[] | undefined,
) {
  const queryClient = useQueryClient()
  const filled = orders?.filter((o) => o.status === 'fulfilled').length ?? 0
  const previousFilled = useRef(filled)
  useEffect(() => {
    if (filled > previousFilled.current) {
      void queryClient.invalidateQueries({ queryKey: ['surplus', chainId, account] })
    }
    previousFilled.current = filled
  }, [filled, chainId, account, queryClient])
}

/** Live solver-competition status for a single order (fetched on demand). */
export function useCompetition(chainId: number | undefined, orderUid: string, enabled: boolean) {
  return useQuery({
    queryKey: ['competition', chainId, orderUid],
    enabled: enabled && chainId !== undefined,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getOrderCompetitionStatus(orderUid)
        .then((envelope) => envelope.value),
  })
}

/** The fills (trades) for a single order, fetched on demand for its receipt. */
export function useTrades(chainId: number | undefined, orderUid: string, enabled: boolean) {
  return useQuery({
    queryKey: ['trades', chainId, orderUid],
    enabled: enabled && chainId !== undefined,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getTrades({ orderUid })
        .then((envelope) => envelope.value),
  })
}

/** Sign and submit one or more order cancellations as a single signed request. */
export function useCancelOrders() {
  const { walletClient, account, chainId } = useWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderUids: string[]) => {
      if (!walletClient || account === undefined || chainId === undefined) {
        throw new Error('Connect a wallet first')
      }
      const signed = (
        await signCancellationWithTypedDataSigner(orderUids, chainId, typedDataSigner(walletClient, account))
      ).value
      await getOrderBookClient(chainId).cancelOrders(signed)
      return orderUids
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders', chainId, account] })
      void queryClient.invalidateQueries({ queryKey: ['surplus', chainId, account] })
    },
  })
}
