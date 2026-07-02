import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    // React adapter — its own bundle so the core package stays React-free.
    react: "src/react.tsx",
  },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  // onnxruntime-node is a native build-time-only dependency — never bundle it.
  // react/react-dom are peer deps — keep them (and the JSX runtime) external.
  external: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "react",
    "react-dom",
    "react/jsx-runtime",
  ],
});
