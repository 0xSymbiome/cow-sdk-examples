import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// Why this pre-bundle step exists.
//
// The cloudflare flavor ships its wasm as a raw `.wasm` file behind the package
// subpath `@symbiome-forge/cow-sdk-wasm/cloudflare/wasm`. `wrangler deploy` bundles a Worker
// with esbuild, and esbuild has no loader for a `.wasm` reached through a *bare*
// package specifier resolved into `node_modules` — it fails with "No loader is
// configured for .wasm files". Wrangler's `CompiledWasm` module rule only attaches
// to `.wasm` files that are *local* to the bundled entrypoint.
//
// So this script does exactly that: it copies the package's wasm next to the built
// worker and rewrites the subpath import to a relative `./cow_sdk_wasm_bg.wasm`
// import, left external. `wrangler.toml` then points `main` at the bundled
// `dist-worker/worker.js` and matches the local wasm with a `CompiledWasm` rule, so
// `wrangler deploy` resolves it as a `WebAssembly.Module` with no dynamic compile.
// The Worker source keeps the canonical package-subpath import; this is the
// real-world technique for deploying a Worker that consumes a package-distributed
// wasm module.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-worker");
const wasmFile = "cow_sdk_wasm_bg.wasm";
const wasmSource = join(
  root,
  "node_modules",
  "@symbiome-forge",
  "cow-sdk-wasm",
  "dist",
  "raw",
  "cloudflare-web",
  wasmFile
);

await access(wasmSource).catch(() => {
  throw new Error(
    "Missing Cloudflare WASM artifact. Run `pnpm install` before building this example."
  );
});

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyFile(wasmSource, join(outDir, wasmFile));

await build({
  absWorkingDir: root,
  bundle: true,
  conditions: ["workerd", "browser", "import", "module"],
  entryPoints: ["src/worker.ts"],
  format: "esm",
  logLevel: "info",
  mainFields: ["browser", "module", "main"],
  outfile: "dist-worker/worker.js",
  platform: "browser",
  target: "es2022",
  plugins: [
    {
      name: "cow-sdk-wasm-cloudflare-module",
      setup(build) {
        build.onResolve(
          { filter: /^@symbiome-forge\/cow-sdk-wasm\/cloudflare\/wasm$/ },
          () => ({
            namespace: "cow-sdk-wasm-module",
            path: "cloudflare-wasm"
          })
        );

        build.onResolve({ filter: /^\.\/cow_sdk_wasm_bg\.wasm$/ }, (args) => ({
          external: true,
          path: args.path
        }));

        build.onLoad({ filter: /.*/, namespace: "cow-sdk-wasm-module" }, () => ({
          contents: `import wasmModule from "./${wasmFile}";\nexport default wasmModule;\n`,
          loader: "js",
          resolveDir: outDir
        }));
      }
    }
  ]
});
