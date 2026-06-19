import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",
  scanDirs: ["server", "shared"],
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