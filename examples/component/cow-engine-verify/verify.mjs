// Reproduce the same CoW order identity from Node, through jco, and assert it
// equals the committed golden — the same fixture the Rust host checks. One
// published artifact, two language hosts, identical bytes.
import { readFileSync } from 'node:fs';
import * as engine from './dist/engine.js';

const g = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url)));
const o = g.order;
const order = {
  sellToken: o.sellToken,
  buyToken: o.buyToken,
  receiver: undefined,
  sellAmount: o.sellAmount,
  buyAmount: o.buyAmount,
  feeAmount: undefined,
  validTo: o.validTo,
  appData: o.appData,
  kind: o.kind,
  partiallyFillable: undefined,
  sellTokenBalance: undefined,
  buyTokenBalance: undefined,
};

const uid = engine.order.uid(BigInt(g.chainId), g.owner, order);
const digest = engine.order.digest(BigInt(g.chainId), order);
// jco maps `list<u64>` to a BigUint64Array — compare with BigInt, not strings.
const chains = engine.chains.supportedChainIds();

console.log('host:   Node + jco');
console.log('engine: published cow-sdk-component-engine (OCI), zero host imports');
console.log(`chains (${chains.length}): ${Array.from(chains).join(', ')}`);
console.log('order.uid   :', uid);
console.log('order.digest:', digest);

const failures = [];
if (uid !== g.expected.uid) failures.push(`uid mismatch: ${uid}`);
if (digest !== g.expected.digest) failures.push(`digest mismatch: ${digest}`);
if (uid.slice(2, 66) !== digest.slice(2)) failures.push('uid does not embed the digest');
if (!chains.includes(BigInt(g.chainId))) failures.push(`chain ${g.chainId} missing`);

if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nPASS: the published engine reproduced the committed order identity byte for byte.');
