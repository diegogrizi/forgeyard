import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "cli/main": "src/cli/main.ts" },
  format: ["esm"],
  target: "node24",
  platform: "node",
  removeNodeProtocol: false,
  splitting: false,
  dts: false,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
