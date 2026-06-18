import { useQuery } from '@tanstack/react-query'
import { erc20Abi, getAddress, isAddress, type Address, type PublicClient } from 'viem'

import { NATIVE_TOKEN_ADDRESS, chainMeta } from '../chains/registry'
import { useWallet } from '../wallet/WalletProvider'
import listRegistry from './token-lists.json'

const REGISTRY = listRegistry as Record<string, string[]>

export interface TokenInfo {
  chainId: number
  /** Lowercased token address; native currency uses the EIP-7528 sentinel. */
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  native?: boolean
}

interface RawToken {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

/** Synthesize the native-currency entry for a chain (the SDK has no token list). */
export function nativeToken(chainId: number): TokenInfo {
  const meta = chainMeta(chainId)
  return {
    chainId,
    address: NATIVE_TOKEN_ADDRESS,
    symbol: meta?.nativeSymbol ?? 'ETH',
    name: meta?.nativeSymbol ?? 'Native',
    decimals: 18,
    native: true,
  }
}

export function isNative(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS
}

async function fetchList(url: string): Promise<RawToken[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const data = (await response.json()) as { tokens?: RawToken[] }
    return data.tokens ?? []
  } catch {
    return []
  }
}

async function buildTokenList(chainId: number): Promise<TokenInfo[]> {
  const urls = REGISTRY[String(chainId)] ?? []
  const lists = await Promise.all(urls.map(fetchList))
  const byAddress = new Map<string, TokenInfo>()
  const native = nativeToken(chainId)
  byAddress.set(native.address, native)
  // Higher-priority lists come first; first definition of an address wins.
  for (const tokens of lists) {
    for (const token of tokens) {
      if (token.chainId !== chainId) continue
      const address = token.address.toLowerCase()
      if (byAddress.has(address)) continue
      byAddress.set(address, {
        chainId,
        address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        ...(token.logoURI ? { logoURI: token.logoURI } : {}),
      })
    }
  }
  return [...byAddress.values()]
}

/** Fetch and merge the chain's published token lists, cached for the session. */
export function useTokenList(chainId: number | undefined) {
  return useQuery({
    queryKey: ['token-list', chainId],
    enabled: chainId !== undefined,
    staleTime: 1000 * 60 * 30,
    queryFn: () => buildTokenList(chainId as number),
  })
}

async function fetchBalances(
  publicClient: PublicClient,
  account: Address,
  tokens: TokenInfo[],
): Promise<Record<string, string>> {
  const balances: Record<string, string> = {}
  const erc20 = tokens.filter((token) => !token.native)
  const hasNative = tokens.some((token) => token.native)

  if (hasNative) {
    balances[NATIVE_TOKEN_ADDRESS] = (await publicClient.getBalance({ address: account })).toString()
  }

  if (erc20.length > 0) {
    try {
      const results = await publicClient.multicall({
        allowFailure: true,
        contracts: erc20.map((token) => ({
          address: token.address as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        })),
      })
      erc20.forEach((token, index) => {
        const result = results[index]
        if (result?.status === 'success') {
          balances[token.address] = (result.result as bigint).toString()
        }
      })
    } catch {
      // Chains without a multicall3 deployment fall back to no ERC-20 balances.
    }
  }

  return balances
}

/** Balances (base units) for the given tokens on the connected account. */
export function useBalances(tokens: TokenInfo[]) {
  const { publicClient, account, chainId } = useWallet()
  const addresses = tokens.map((token) => token.address)
  return useQuery({
    queryKey: ['balances', chainId, account, addresses],
    enabled: Boolean(publicClient) && Boolean(account) && tokens.length > 0,
    refetchInterval: 15_000,
    queryFn: () => fetchBalances(publicClient as PublicClient, account as Address, tokens),
  })
}

/** Read an arbitrary ERC-20's metadata so users can import tokens by address. */
export async function importToken(
  publicClient: PublicClient,
  chainId: number,
  rawAddress: string,
): Promise<TokenInfo> {
  if (!isAddress(rawAddress)) throw new Error('Not a valid address')
  const address = getAddress(rawAddress)
  const contract = { address, abi: erc20Abi } as const
  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({ ...contract, functionName: 'symbol' }),
    publicClient.readContract({ ...contract, functionName: 'name' }),
    publicClient.readContract({ ...contract, functionName: 'decimals' }),
  ])
  return { chainId, address: address.toLowerCase(), symbol, name, decimals }
}
