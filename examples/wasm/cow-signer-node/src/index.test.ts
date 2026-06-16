import { describe, expect, test } from "vitest";
import { CHAIN_ID, OWNER, pureArtifacts, signEip712, signEip1271 } from "./index.js";

// These tests assert the SDK's own output: deterministic protocol values and
// well-formed signed orders. They intentionally do not compare against an
// independent signing library's vectors — cross-implementation parity is proven
// in the crate and e2e lanes, not duplicated in an example.

describe("Signing flavor (Node.js)", () => {
  test("protocol helpers are deterministic and well formed", () => {
    const first = pureArtifacts();
    const second = pureArtifacts();

    expect(first.orderUid).toBe(second.orderUid);
    expect(first.domainSeparator).toBe(second.domainSeparator);
    expect(first.typedData).toStrictEqual(second.typedData);

    expect(first.orderUid).toMatch(/^0x[0-9a-f]+$/);
    expect(first.domainSeparator).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.typedData.primaryType).toBe("Order");
  });

  test("signs an order with the EIP-712 scheme", async () => {
    const signed = await signEip712();

    expect(signed.schemaVersion).toBe("v1");
    // The SDK normalizes the owner address to lowercase; viem returns it EIP-55
    // checksummed, so compare case-insensitively.
    expect(signed.value.from).toBe(OWNER.toLowerCase());
    expect(signed.value.signingScheme).toBe("eip712");
    // A 65-byte secp256k1 signature: 0x + 130 hex characters.
    expect(signed.value.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(signed.value.orderUid).toBe(pureArtifacts().orderUid);
  });

  test("wraps the same signature into the EIP-1271 scheme", async () => {
    const signed = await signEip1271();

    expect(signed.schemaVersion).toBe("v1");
    expect(signed.value.from).toBe(OWNER.toLowerCase());
    expect(signed.value.signingScheme).toBe("eip1271");
    expect(signed.value.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  test("targets the configured chain", () => {
    expect(CHAIN_ID).toBe(11155111);
  });
});
