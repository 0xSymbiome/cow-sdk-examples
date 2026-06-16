// Types `cloudflare:workers` `exports.default` to this worker's default export,
// so the tests can use the non-deprecated `exports.default.fetch()` instead of
// the deprecated `cloudflare:test` `SELF`. This is the `Cloudflare.GlobalProps.
// mainModule` augmentation that `wrangler types` emits.
//
// Unlike the `e2e/wasm-typescript-cf` project (whose wrangler `main` is its
// `src/worker.ts`, so `wrangler types --include-runtime=false` is wired in
// directly), this example's wrangler `main` is the *built* `dist-worker/worker.js`
// produced by `scripts/build.mjs` after type-checking. Pointing `mainModule` at
// that not-yet-built, untyped artifact would break `tsc`, so we type against the
// worker source — which is exactly the contract the test exercises.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./worker");
  }
}
