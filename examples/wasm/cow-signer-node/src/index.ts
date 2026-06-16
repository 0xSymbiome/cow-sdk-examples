import { pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import type { TypedDataDefinition } from "viem";
import {
  computeOrderUid,
  domainSeparator,
  orderTypedData,
  signOrderWithEip1271,
  signOrderWithTypedDataSigner,
  wasmVersion,
  type OrderInput,
  type SignedOrderDto,
  type TypedDataEnvelopeDto,
  type WasmEnvelope
} from "@symbiome-forge/cow-sdk-wasm/signing";

// A Node.js signer built on the `signing` flavor: the smallest package surface
// (signing, UID, and domain helpers; no orderbook, trading, subgraph, or IPFS
// clients). It signs an order with EIP-712 and EIP-1271 entirely offline and
// deterministically — no network, no wallet extension, and no secrets — and the
// signatures match the Rust SDK because both are backed by one implementation.

// Sepolia. Signing is offline and nothing is posted, so no funds are at risk; the
// chain id only selects the EIP-712 domain and the settlement verifying contract.
export const CHAIN_ID = 11155111;

// A well-known, publicly published development key (the standard local-node test
// account). It is here only to produce a real, reproducible signature offline.
// NEVER put a funded key in source. The signing flavor holds no key material: the
// SDK builds the EIP-712 payload, your signer signs it, and the SDK wraps the
// signature your signer returns.
const DEMO_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(DEMO_PRIVATE_KEY);

export const OWNER = account.address;

// A fixed order so the example is reproducible. A real backend maps this from a
// fetched quote and computes `validTo` as `Math.floor(Date.now() / 1000) + ttl`.
export const ORDER: OrderInput = {
  sellToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  buyToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  receiver: OWNER,
  sellAmount: "1000000000000000000",
  buyAmount: "2000000000",
  validTo: 1893456000,
  appData: "0x337aa6e6c2a7a0d1eb79a35ebd88b08fc963d5f7a3fc953b7ffb2b7f5898a1df",
  feeAmount: "0",
  kind: "sell",
  partiallyFillable: false,
  sellTokenBalance: "erc20",
  buyTokenBalance: "erc20"
};

// The signer the consumer owns. The SDK hands its EIP-712 envelope — `domain`,
// `types`, `primaryType`, and `message`, all serialized across the wasm boundary
// as plain JSON objects — to this callback, and viem's local account signs it. The
// envelope already carries viem's runtime shape, but the SDK's generated types are
// wider than viem's abitype-derived `TypedDataDefinition` (e.g. `verifyingContract`
// is a plain `string` and `message` is `unknown`), so the boundary takes the
// explicit `as unknown as` cast TypeScript itself recommends for non-overlapping
// types.
async function signEnvelope(envelope: TypedDataEnvelopeDto): Promise<string> {
  return account.signTypedData(envelope as unknown as TypedDataDefinition);
}

export interface PureArtifacts {
  version: string;
  domainSeparator: string;
  orderUid: string;
  typedData: TypedDataEnvelopeDto;
}

// Deterministic, network-free protocol logic. The same Rust implementation backs
// the native SDK and this package, so these values are identical across runtimes
// and stable across runs.
export function pureArtifacts(): PureArtifacts {
  return {
    version: wasmVersion(),
    domainSeparator: domainSeparator(CHAIN_ID),
    orderUid: computeOrderUid(ORDER, CHAIN_ID, OWNER).value.orderUid,
    typedData: orderTypedData(ORDER, CHAIN_ID).value
  };
}

// EOA signing: the canonical EIP-712 scheme. `from` is the signer address.
export function signEip712(): Promise<WasmEnvelope<SignedOrderDto>> {
  return signOrderWithTypedDataSigner(ORDER, CHAIN_ID, OWNER, signEnvelope);
}

// Smart-contract scheme: the SDK wraps the same ECDSA signature into the EIP-1271
// contract-signature payload. A real integration uses the contract account's
// address as the owner; here the demo key stands in to show the payload shape.
export function signEip1271(): Promise<WasmEnvelope<SignedOrderDto>> {
  return signOrderWithEip1271(ORDER, CHAIN_ID, OWNER, signEnvelope);
}

async function main(): Promise<void> {
  const pure = pureArtifacts();
  const eip712 = await signEip712();
  const eip1271 = await signEip1271();
  console.log(
    JSON.stringify(
      {
        version: pure.version,
        owner: OWNER,
        orderUid: pure.orderUid,
        eip712Scheme: eip712.value.signingScheme,
        eip1271Scheme: eip1271.value.signingScheme
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
