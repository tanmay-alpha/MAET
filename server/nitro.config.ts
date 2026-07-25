// Nitro configuration for the MAET backend server (Render deployment).
import { defineNitroConfig } from "nitropack/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

const config = {
  preset: "node-server",
  serverDir: ".",
  compatibilityDate: "2026-07-03" as const,
  alias: {
    "@shared": resolve(currentDir, "../shared"),
  },

  // Exclude test files and spec files so colocated *.test.ts files
  // under api/ (which import bun:test) don't get compiled as routes.
  ignore: ["**/*.test.ts", "**/*.spec.ts"],

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
