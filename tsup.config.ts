import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  // onnxruntime-node is a native build-time-only dependency — never bundle it.
  external: ["@huggingface/transformers", "onnxruntime-node"],
});
