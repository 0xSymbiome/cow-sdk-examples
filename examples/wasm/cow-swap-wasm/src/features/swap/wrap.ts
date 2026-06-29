import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'

import { wrappedNativeToken, type WrappedNativeToken } from '@symbiome-forge/cow-sdk-wasm/trading'

import { isSupportedChain } from '../../chains/registry'
import { getTradingClient } from '../../lib/cow'
import { useWallet } from '../../wallet/WalletProvider'

export type WrapMode = 'wrap' | 'unwrap'

/**
 * The chain's wrapped-native token (WETH, WXDAI, …) resolved from the SDK — a
 * synchronous, deterministic call, so no per-chain table is maintained here.
 * Returns `undefined` on an unsupported chain instead of throwing.
 */
export function wrappedNativeFor(chainId: number | undefined): WrappedNativeToken | undefined {
  if (chainId === undefined || !isSupportedChain(chainId)) return undefined
  return wrappedNativeToken(chainId).value
}

/**
 * Wrap native currency into its wrapped-native token, or unwrap it back. The SDK
 * builds the transaction — `deposit()` or `withdraw(amount)`, wrapped-native
 * address resolved internally — and the wallet submits it. A wrap is 1:1, so it
 * needs no token approval, quote, or signature.
 */
export function useWrapUnwrap() {
  const { walletClient, publicClient, account, chainId } = useWallet()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mode, atoms }: { mode: WrapMode; atoms: string }): Promise<Hex> => {
      if (!walletClient || !publicClient || account === undefined || chainId === undefined) {
        throw new Error('Connect a wallet first')
      }
      const trading = getTradingClient(chainId)
      const tx = (mode === 'wrap' ? trading.buildWrapTx(atoms) : trading.buildUnwrapTx(atoms)).value
      const hash = await walletClient.sendTransaction({
        account,
        chain: null,
        to: tx.to as Address,
        data: (tx.data ?? '0x') as Hex,
        value: BigInt(tx.value ?? '0'),
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return hash
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['balances'] }),
  })
}
