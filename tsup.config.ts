import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "node",
  bundle: true,
  skipNodeModulesBundle: true,
  external: ["@aws-sdk/client-dynamodb"],
  splitting: false,
  cjsInterop: true,
});
