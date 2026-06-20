import { exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { CowError } from "@symbiome-forge/cow-sdk-wasm/trading/edge";
import { upstreamErrorResponse } from "../src/worker.js";

describe("Cloudflare gateway worker", () => {
  test("initializes the cloudflare wasm flavor and reports chains", async () => {
    const response = await exports.default.fetch("https://example.test/health");
    const payload = await response.json<{ ok: boolean; supportedChainIds: number[] }>();

    expect(payload.ok).toBe(true);
    expect(payload.supportedChainIds).toContain(1);
  });
});

describe("Gateway upstream error mapping", () => {
  test("relays a retryable orderbook failure as 503 with Retry-After", async () => {
    const response = upstreamErrorResponse(
      new CowError({
        kind: "orderbook",
        code: "429",
        message: "rate limited",
        retryable: true,
        retryAfterMs: 30_000
      })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    const payload = await response.json<{ error: string; retryable: boolean }>();
    expect(payload.retryable).toBe(true);
  });

  test("relays a retryable failure without a backoff hint as a bare 503", () => {
    const response = upstreamErrorResponse(
      new CowError({ kind: "orderbook", code: "503", message: "service unavailable", retryable: true })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
  });

  test("maps a non-retryable orderbook failure to 502", () => {
    const response = upstreamErrorResponse(
      new CowError({ kind: "orderbook", code: "400", message: "bad request", retryable: false })
    );

    expect(response.status).toBe(502);
  });

  test("normalizes a non-SDK throw to a 502", () => {
    const response = upstreamErrorResponse(new Error("socket hang up"));
    expect(response.status).toBe(502);
  });
});
