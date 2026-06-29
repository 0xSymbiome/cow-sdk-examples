import {
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'

import {
  buildAppData,
  buildTwapCreateTransaction,
  domainSeparator,
  type TransactionRequest,
} from '@symbiome-forge/cow-sdk-wasm/trading'

import { APP_CODE } from '../config'
import { ensureCowReady, getOrderBookClient, getTradingClient } from '../lib/cow'
import { contractReader } from '../lib/cow-callbacks'
import { MAX_UINT256 } from '../features/swap/settings'

// ComposableCoW and the ExtensibleFallbackHandler are CREATE2 singletons,
// deployed at the same address on every supported chain.
const COMPOSABLE_COW = '0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74' as Address
const EXTENSIBLE_FALLBACK_HANDLER = '0x2f55e8b20D0B9FEFA187AA7d00B6Cbe563605bF5' as Address
// The Safe fallback-handler storage slot: keccak256("fallback_manager.handler.address").
const FALLBACK_HANDLER_SLOT =
  '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5' as Hex

/**
 * Whether `account` is a smart-contract wallet (a Safe), not an EOA. TWAP /
 * composable orders are EIP-1271 authenticated, so the owner must be a contract.
 * This is the predicate the TWAP form is gated on.
 */
export async function isSmartContractWallet(
  publicClient: PublicClient,
  account: Address,
): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: account })
  return code !== undefined && code !== '0x'
}

interface MetaTx {
  to: string
  value: string
  data: string
}

function toMetaTx(tx: TransactionRequest): MetaTx {
  return { to: tx.to as string, value: (tx.value ?? '0') as string, data: (tx.data ?? '0x') as string }
}

export interface CreateTwapInput {
  walletClient: WalletClient
  publicClient: PublicClient
  account: Address
  chainId: number
  sellToken: string
  buyToken: string
  /** Total sell amount across all parts, in atoms. */
  sellAmount: string
  /** Total minimum buy amount across all parts, in atoms. */
  buyAmount: string
  numberOfParts: number
  /** Seconds between parts. */
  timeBetweenParts: number
  /** Price-protection slippage in basis points, recorded in the order's app-data. */
  slippageBps: number
  receiver?: string
}

export interface TwapResult {
  orderId: string
  txHash: string
}

/**
 * Creates a TWAP conditional order from the connected Safe. The SDK builds the
 * `createWithContext` transaction and order id; this submits it through the Safe,
 * prefixed only when needed with the one-time `ExtensibleFallbackHandler` setup and
 * a sell-token approval. The watch tower then posts each part as it goes live.
 */
export async function createTwapOrder(input: CreateTwapInput): Promise<TwapResult> {
  await ensureCowReady()
  const { walletClient, publicClient, account, chainId } = input

  // The handler stores per-part amounts, so the SDK requires each total to divide
  // evenly across the parts (it rejects a remainder). Round both down to an exact
  // multiple of the part count — the per-part amounts the user sees.
  const parts = BigInt(input.numberOfParts)
  const sellTotal = ((BigInt(input.sellAmount) / parts) * parts).toString()
  const buyTotal = ((BigInt(input.buyAmount) / parts) * parts).toString()

  // App-data: the builder stamps the class, slippage, schema version, and UTM, so
  // nothing is hand-rolled. `orderClass: 'twap'` is the app-data's own class — a
  // separate concept from the order book's class (the parts post as limit orders).
  // Upload it so the watch tower attaches it to every part.
  const appData = buildAppData({
    appCode: APP_CODE,
    slippageBps: input.slippageBps,
    orderClass: 'twap',
  }).value
  await getOrderBookClient(chainId).uploadAppData(appData.appDataHex, appData.appDataContent)

  const built = buildTwapCreateTransaction({
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: sellTotal,
    buyAmount: buyTotal,
    numberOfParts: input.numberOfParts,
    timeBetweenParts: input.timeBetweenParts,
    salt: randomSalt(),
    appData: appData.appDataHex,
    ...(input.receiver ? { receiver: input.receiver } : {}),
  }).value

  const txs: MetaTx[] = []

  // 1. One-time Safe setup: install the ExtensibleFallbackHandler and point the
  //    CoW domain verifier at ComposableCoW so the watch tower's EIP-1271
  //    signatures validate. Skipped when the Safe is already composable-ready.
  if (!(await isComposableReady(publicClient, account))) {
    const domainSep = domainSeparator(chainId).value
    txs.push(setFallbackHandlerTx(account), setDomainVerifierTx(account, domainSep))
  }

  // 2. Approval: let the protocol pull the sell token across the parts.
  const trading = getTradingClient(chainId)
  const allowance = (
    await trading.getCowProtocolAllowance(
      { tokenAddress: input.sellToken, owner: account },
      contractReader(publicClient),
    )
  ).value
  if (BigInt(allowance) < BigInt(sellTotal)) {
    const approve = (await trading.buildApprovalTx({ tokenAddress: input.sellToken, amount: MAX_UINT256 })).value
    txs.push(toMetaTx(approve))
  }

  // 3. The conditional-order authorization itself.
  txs.push(toMetaTx(built.transaction))

  // Submit as one atomic EIP-5792 batch (`wallet_sendCalls`): the optional setup
  // and approval land with the create in a single Safe confirmation. Wallets
  // without EIP-5792 fall back to sequential transactions.
  const calls = txs.map((tx) => ({
    to: tx.to as Address,
    data: tx.data as Hex,
    value: BigInt(tx.value),
  }))

  try {
    const sent: { id: string } | string = await walletClient.sendCalls({ account, calls })
    return { orderId: built.orderId, txHash: typeof sent === 'string' ? sent : sent.id }
  } catch (error) {
    if (!isBatchingUnsupported(error)) throw error
    let txHash = ''
    for (const call of calls) {
      txHash = await walletClient.sendTransaction({ account, chain: null, ...call })
    }
    return { orderId: built.orderId, txHash }
  }
}

// EIP-5792 is optional; detect a wallet that doesn't implement `wallet_sendCalls`
// so we fall back to sequential sends rather than surfacing it as a real failure.
function isBatchingUnsupported(error: unknown): boolean {
  const e = error as { code?: number; message?: string }
  if (e.code === 4200 || e.code === -32601) return true
  return /unsupported|not support|method .*not |does not exist|sendcalls/i.test(e.message ?? '')
}

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Whether the Safe's fallback handler is already the ExtensibleFallbackHandler. */
async function isComposableReady(publicClient: PublicClient, safe: Address): Promise<boolean> {
  const word = (await publicClient.getStorageAt({ address: safe, slot: FALLBACK_HANDLER_SLOT })) ?? '0x'
  return word.toLowerCase().endsWith(EXTENSIBLE_FALLBACK_HANDLER.slice(2).toLowerCase())
}

const SET_FALLBACK_HANDLER_ABI = [
  {
    type: 'function',
    name: 'setFallbackHandler',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'handler', type: 'address' }],
    outputs: [],
  },
] as const

const SET_DOMAIN_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'setDomainVerifier',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'domainSeparator', type: 'bytes32' },
      { name: 'verifier', type: 'address' },
    ],
    outputs: [],
  },
] as const

function setFallbackHandlerTx(safe: string): MetaTx {
  return {
    to: safe,
    value: '0',
    data: encodeFunctionData({
      abi: SET_FALLBACK_HANDLER_ABI,
      functionName: 'setFallbackHandler',
      args: [EXTENSIBLE_FALLBACK_HANDLER],
    }),
  }
}

function setDomainVerifierTx(safe: string, domainSep: string): MetaTx {
  return {
    to: safe,
    value: '0',
    data: encodeFunctionData({
      abi: SET_DOMAIN_VERIFIER_ABI,
      functionName: 'setDomainVerifier',
      args: [domainSep as Hex, COMPOSABLE_COW],
    }),
  }
}
