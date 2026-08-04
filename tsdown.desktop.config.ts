import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/desktop/main.ts", "src/desktop/indexWorker.ts"],
  format: "cjs",
  platform: "node",
  outDir: "dist/desktop",
  deps: {
    alwaysBundle: [/^@hono\/node-server(?:\/|$)/, /^hono(?:\/|$)/, "zod"],
  },
});
