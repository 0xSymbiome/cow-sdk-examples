import type {
  ContractReadCallback,
  TypedDataSignerCallback,
} from '@symbiome-forge/cow-sdk-wasm/trading'
import type { Abi, Address, PublicClient, TypedDataDomain, WalletClient } from 'viem'

// Adapters between viem and the SDK's callback interfaces. viem performs the
// wallet signing and contract reads; the SDK builds the payloads it hands back.
// No private key passes through the SDK, and ABI encoding is delegated to viem.

/**
 * Wire an injected wallet to the SDK's order/cancellation signer. The SDK hands
 * us a ready EIP-712 envelope; viem signs it via `eth_signTypedData_v4` and
 * normalizes the domain. The key never enters the SDK or this app.
 */
export function typedDataSigner(wallet: WalletClient, account: Address): TypedDataSignerCallback {
  return (envelope) => {
    // viem derives `EIP712Domain` from `domain`; drop it from `types` if present.
    const types = Object.fromEntries(
      Object.entries(envelope.types).filter(([name]) => name !== 'EIP712Domain'),
    ) as Record<string, readonly { name: string; type: string }[]>
    const domain: TypedDataDomain = {
      name: envelope.domain.name,
      version: envelope.domain.version,
      chainId: Number(envelope.domain.chainId),
      verifyingContract: envelope.domain.verifyingContract as Address,
    }
    return wallet.signTypedData({
      account,
      domain,
      types,
      primaryType: envelope.primaryType,
      message: envelope.message as Record<string, unknown>,
    })
  }
}

/**
 * Back the SDK's read-only contract callback (the CoW allowance check) with viem:
 * viem runs the `eth_call` and decodes; we return the SDK's expected shape — the
 * decoded value JSON-stringified, integers as decimal strings, addresses lowercased.
 */
export function contractReader(publicClient: PublicClient): ContractReadCallback {
  return async (call): Promise<string> => {
    const parsed: unknown = JSON.parse(call.abiJson)
    const abi = (Array.isArray(parsed) ? parsed : [parsed]) as Abi
    const args = JSON.parse(call.argsJson) as readonly unknown[]
    const decoded = await publicClient.readContract({
      address: call.address as Address,
      abi,
      functionName: call.method,
      args: args as never,
    })
    return JSON.stringify(toCowJsonValue(decoded))
  }
}

// Mirror the SDK's reference decoder: uints/ints become decimal strings,
// addresses/bytes become lowercase 0x-hex, bools stay bools, tuples/arrays recurse.
// Exported for unit testing — it must match the Rust reference exactly.
export function toCowJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'string') return value.startsWith('0x') ? value.toLowerCase() : value
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(toCowJsonValue)
  if (value && typeof value === 'object') return Object.values(value).map(toCowJsonValue)
  return value
}
