import initialize, {
  OrderBookClient,
  isCowError,
  isRetryable,
  normalizeError,
  retryAfterMs,
  supportedChainIds,
  type HttpTransportConfig,
  type OrderQuoteRequestInput
} from "@symbiome-forge/cow-sdk-wasm/trading/edge";
import wasmModule from "@symbiome-forge/cow-sdk-wasm/trading/edge/wasm";

// A Cloudflare Worker that runs CoW order flow on Cloudflare's edge runtime: a
// gateway in front of the CoW orderbook, built on the `trading` flavor's edge
// target. The Worker owns configuration (chain, environment, partner key) and can
// own egress.

export interface WorkerEnv {
  COW_CHAIN_ID?: string;
  COW_ENV?: "prod" | "staging";
  COW_PARTNER_API_KEY?: string;
  COW_TRACE?: string;
}

// The callback transport's request/response shapes, derived from the public
// config type so the example never imports package-internal modules.
type CallbackTransport = Extract<HttpTransportConfig, { kind: "callback" }>;
type EgressRequest = Parameters<CallbackTransport["callback"]>[0];
type EgressResponse = Awaited<ReturnType<CallbackTransport["callback"]>>;

let ready: Promise<void> | undefined;

// The trading flavor's edge target is a `web`-target wasm build initialized once
// per isolate from the bundled wasm module. The build wires it as a Worker
// `CompiledWasm` binding, so there is no dynamic wasm compilation or streaming
// instantiation at runtime.
async function ensureReady(): Promise<void> {
  if (!ready) {
    ready = initialize(wasmModule);
  }
  await ready;
}

// Host-owned egress. The SDK can call the Worker's global `fetch` directly with
// `{ kind: "fetch" }`; a callback transport is only worth reaching for to add an
// edge concern the SDK does not model. Here that concern is observability: one
// structured log line per outbound request. The callback still delegates to the
// platform `fetch` — it does not re-implement HTTP. The same shape is where a
// gateway would add caching, rate-limiting, or its own auth header.
export async function tracedEgress(
  request: EgressRequest,
  fetcher: typeof fetch = fetch
): Promise<EgressResponse> {
  const response = await fetcher(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  console.log(
    JSON.stringify({
      at: "cow.egress",
      method: request.method,
      url: request.url,
      status: response.status
    })
  );

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.text()
  };
}

// Default to the built-in fetch adapter; the partner API key is a first-class
// client field, so a simple gateway needs no custom transport. Opt into the
// host-owned egress path (request tracing) by setting `COW_TRACE=1`.
function gatewayTransport(env: WorkerEnv): HttpTransportConfig {
  if (env.COW_TRACE === "1") {
    return { kind: "callback", callback: tracedEgress };
  }
  return { kind: "fetch" };
}

// Every SDK call throws a `CowError` — a real `Error` subclass that also forms a
// discriminated union keyed by `kind`. The package ships the retry-verdict helpers
// (`isRetryable`, `retryAfterMs`), so the gateway reads the SDK's own
// classification instead of restating the orderbook error shape by hand.

// Maps an SDK failure to a gateway response. The SDK already retried the request
// internally and exhausted its budget, so a failure it still classifies as
// retryable is transient (a rate limit or a server-fault status): the gateway
// relays it as a 503 with a `Retry-After` header derived from the SDK's
// `retryAfterMs` hint when present, and lets the caller back off. Everything else
// is a failure that resubmitting unchanged will not fix, so it stays a 502.
export function upstreamErrorResponse(error: unknown): Response {
  // Normalize a foreign throw or a plain wire object into a `CowError` so the
  // verdict and message read the same way no matter how the failure arrived.
  const cowError = isCowError(error) ? error : normalizeError(error);
  if (isRetryable(cowError)) {
    const headers: Record<string, string> = {};
    const afterMs = retryAfterMs(cowError);
    if (afterMs !== undefined) {
      headers["retry-after"] = String(Math.ceil(afterMs / 1000));
    }
    return Response.json({ error: cowError.message, retryable: true }, { status: 503, headers });
  }
  return Response.json({ error: cowError.message }, { status: 502 });
}

export function createOrderBookClient(env: WorkerEnv): OrderBookClient {
  return new OrderBookClient({
    chainId: Number.parseInt(env.COW_CHAIN_ID ?? "1", 10),
    env: env.COW_ENV ?? "prod",
    apiKey: env.COW_PARTNER_API_KEY ?? null,
    transport: gatewayTransport(env),
    transportPolicy: { userAgent: "cow-sdk-wasm-gateway-cloudflare-example/0.1.0" }
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    await ensureReady();
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, supportedChainIds: Array.from(supportedChainIds()) });
    }

    if (request.method === "POST" && url.pathname === "/quote") {
      let quoteRequest: OrderQuoteRequestInput;
      try {
        quoteRequest = (await request.json()) as OrderQuoteRequestInput;
      } catch {
        // Malformed/empty body: a client error, so return a structured 400 rather
        // than letting the JSON parse throw surface as Cloudflare's 1101 page.
        return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
      }

      const client = createOrderBookClient(env);
      try {
        const quote = await client.getQuote(quoteRequest, { timeoutMs: 8_000 });
        return Response.json(quote);
      } catch (error) {
        // The orderbook rejected the request, timed out, or the transport failed.
        // A gateway answers with a structured upstream error, not an opaque 500,
        // and relays a retryable failure as a 503 with `Retry-After`.
        return upstreamErrorResponse(error);
      } finally {
        // Release the wasm-held client resources for this request.
        client.dispose();
      }
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<WorkerEnv>;
