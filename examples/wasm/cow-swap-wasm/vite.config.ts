/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// The `trading` flavor is consumed through its `bundler` target: the wasm-bindgen
// bundler output references the `.wasm` asset, which vite-plugin-wasm instantiates
// on import. Vite 8 (Rolldown) with an es2022 target supports the resulting
// top-level await natively. React Compiler runs as a Babel pass via the plugin's
// reactCompilerPreset.
export default defineConfig({
  base: './',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), wasm()],
  // The SDK ships its own instantiated wasm; let Vite handle it via the wasm
  // plugin rather than esbuild's dependency pre-bundling.
  optimizeDeps: { exclude: ['@symbiome-forge/cow-sdk-wasm'] },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
