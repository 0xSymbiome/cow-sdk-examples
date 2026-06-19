/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The `trading` flavor resolves to its `web` target for the browser: the facade
// calls `initialize()` once (see `ensureCowReady`) and the loader fetches the wasm
// through `new URL('..._bg.wasm', import.meta.url)`, an asset Vite emits and
// resolves natively across every bundler and with no bundler at all — so no
// `vite-plugin-wasm` (the bundler-target `import * as wasm` integration that broke
// on static hosting) is needed. React Compiler runs as a Babel pass via the
// plugin's reactCompilerPreset.
export default defineConfig({
  base: './',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  // The SDK owns its own wasm instantiation through `initialize()`; keep it out of
  // esbuild dependency pre-bundling so Vite serves the ESM facade and wasm asset.
  optimizeDeps: { exclude: ['@symbiome-forge/cow-sdk-wasm'] },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
