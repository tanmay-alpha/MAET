// Nitro configuration for the MAET backend server (Render deployment).
import { defineNitroConfig } from "nitropack/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

const config = {
  preset: "node-server",
  serverDir: ".",
  modules: [],
  compatibilityDate: "2026-07-03" as const,
  alias: {
    "@shared": resolve(currentDir, "../shared"),
  },

  // Exclude test files, spec files, and domain modules directory
  // so server/modules (DDD domain code) is not auto-scanned as Nitro framework modules.
  ignore: ["**/*.test.ts", "**/*.spec.ts", "modules/**"],

  // Path aliases for TypeScript resolution at build time.
  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: {
          "@server/*": ["./*"],
          "@shared/*": ["../shared/*"],
        },
      },
    },
  },

  // Route-level cache headers.
  routeRules: {
    "/api/stream/**": { headers: { "cache-control": "no-store" } },
  },
};

export default defineNitroConfig(config);
