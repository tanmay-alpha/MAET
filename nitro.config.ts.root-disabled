import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",
  scanDirs: ["server", "shared"],
  // Exclude test files from route scanning so colocated `*.test.ts` files
  // under `api/` (which import `bun:test`) don't get compiled as routes
  // and bloats the bundle. See server/api/trpc/auth.test.ts for the
  // canonical case. The `ignore` option is passed to globby by Nitro's
  // internal `scanDir`.
  ignore: ["**/*.test.ts", "**/*.spec.ts"],
  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: {
          "@shared/*": ["./shared/*"],
          "@server/*": ["./server/*"],
        },
      },
    },
  },
  routeRules: {
    "/api/stream/**": { headers: { "cache-control": "no-store" } },
  },
});