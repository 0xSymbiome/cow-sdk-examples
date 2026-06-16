import { describe, expect, test } from "vitest";
import source from "../src/worker.ts?raw";

describe("Worker source", () => {
  test("uses the package wasm module instead of dynamic wasm compilation", () => {
    const forbidden = [
      "WebAssembly.compile",
      "WebAssembly.compileStreaming",
      "WebAssembly.instantiateStreaming",
      "WebAssembly.instantiate("
    ];

    for (const pattern of forbidden) {
      expect(source.includes(pattern), pattern).toBe(false);
    }
  });
});
