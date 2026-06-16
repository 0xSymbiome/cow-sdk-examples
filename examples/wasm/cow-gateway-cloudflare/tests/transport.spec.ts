import { describe, expect, test } from "vitest";
import { tracedEgress } from "../src/worker.js";

// The host-owned egress path delegates the SDK's outbound request to `fetch` and
// returns the origin response unchanged. This exercises the `{ kind: "callback" }`
// transport without standing up the full Worker.
describe("Gateway host-owned egress", () => {
  test("delegates the SDK request to fetch and returns the origin response", async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(String(input)).toBe("https://api.cow.fi/mainnet/api/v1/quote");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe('{"kind":"sell"}');

      return new Response('{"quote":{"id":1}}', {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const response = await tracedEgress(
      {
        method: "POST",
        url: "https://api.cow.fi/mainnet/api/v1/quote",
        headers: { "content-type": "application/json" },
        body: '{"kind":"sell"}'
      },
      fetcher
    );

    expect(response.status).toBe(200);
    expect(response.headers?.["content-type"]).toContain("application/json");
    expect(response.body).toBe('{"quote":{"id":1}}');
  });
});
