import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'

import { signCancellationWithTypedDataSigner } from '@symbiome-forge/cow-sdk-wasm/trading'

import { ORDER_POLL_INTERVAL_MS } from '../../config'
import { getOrderBookClient } from '../../lib/cow'
import { typedDataSigner } from '../../lib/cow-callbacks'
import { useWallet } from '../../wallet/WalletProvider'

/** The connected account's recent orders, polled while mounted. */
export function useOrders(chainId: number | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['orders', chainId, account],
    enabled: chainId !== undefined && account !== undefined,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getOrders(account as Address)
        .then((envelope) => envelope.value),
  })
}

/** Cumulative surplus CoW has captured for the account — the headline value-prop. */
export function useTotalSurplus(chainId: number | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['surplus', chainId, account],
    enabled: chainId !== undefined && account !== undefined,
    refetchInterval: ORDER_POLL_INTERVAL_MS * 3,
    queryFn: () =>
      getOrderBookClient(chainId as number)
        .getTotalSurplus(account as Address)
        .then((envelope) => envelope.value),
  })
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

/** Sign and submit an order cancellation (typed-data signed, then posted). */
export function useCancelOrder() {
  const { walletClient, account, chainId } = useWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderUid: string) => {
      if (!walletClient || account === undefined || chainId === undefined) {
        throw new Error('Connect a wallet first')
      }
      const signed = (
        await signCancellationWithTypedDataSigner(
          [orderUid],
          chainId,
          typedDataSigner(walletClient, account),
        )
      ).value
      await getOrderBookClient(chainId).cancelOrders(signed)
      return orderUid
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders', chainId, account] })
      void queryClient.invalidateQueries({ queryKey: ['surplus', chainId, account] })
    },
  })
}
