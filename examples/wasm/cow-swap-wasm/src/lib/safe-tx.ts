import type { Address, Hex, PublicClient, WalletClient } from 'viem'

import type { TransactionRequest } from '@symbiome-forge/cow-sdk-wasm/trading'

// Shared Safe (smart-contract wallet) transaction plumbing. Both Safe flows — TWAP's
// EIP-1271 conditional orders and a pre-sign swap/limit's on-chain activation — submit
// one or more SDK-built calls through the Safe, so the EIP-5792 batch and the
// sequential fallback live here once rather than being copied per flow.

/**
 * Whether `account` is a smart-contract wallet (a Safe), not an EOA. A Safe cannot
 * produce an off-chain ECDSA signature, so the swap/limit pre-sign path and the TWAP
 * conditional-order path both branch on this predicate.
 */
export async function isSmartContractWallet(
  publicClient: PublicClient,
  account: Address,
): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: account })
  return code !== undefined && code !== '0x'
}

/** A `to`/`value`/`data` triple — the SDK's `TransactionRequest` reduced to a call. */
export interface SafeCall {
  to: Address
  value: bigint
  data: Hex
}

/** Normalize an SDK `TransactionRequest` into a `sendCalls`/`sendTransaction` call. */
export function toSafeCall(tx: TransactionRequest): SafeCall {
  return {
    to: tx.to as Address,
    value: BigInt(tx.value ?? '0'),
    data: (tx.data ?? '0x') as Hex,
  }
}

/**
 * Submit a batch of calls through a Safe as one atomic EIP-5792 request
 * (`wallet_sendCalls`): every call lands in a single Safe confirmation. Wallets
 * that don't implement EIP-5792 fall back to sequential `sendTransaction`s.
 *
 * Returns the identifier the wallet reports — the EIP-5792 bundle id, or the last
 * transaction hash on the sequential path.
 */
export async function sendCallsThroughSafe(
  walletClient: WalletClient,
  account: Address,
  calls: SafeCall[],
): Promise<string> {
  try {
    const sent: { id: string } | string = await walletClient.sendCalls({ account, calls })
    return typeof sent === 'string' ? sent : sent.id
  } catch (error) {
    if (!isBatchingUnsupported(error)) throw error
    let txHash = ''
    for (const call of calls) {
      txHash = await walletClient.sendTransaction({ account, chain: null, ...call })
    }
    return txHash
  }
}

// EIP-5792 is optional; detect a wallet that doesn't implement `wallet_sendCalls`
// so we fall back to sequential sends rather than surfacing it as a real failure.
export function isBatchingUnsupported(error: unknown): boolean {
  const e = error as { code?: number; message?: string }
  if (e.code === 4200 || e.code === -32601) return true
  return /unsupported|not support|method .*not |does not exist|sendcalls/i.test(e.message ?? '')
}
