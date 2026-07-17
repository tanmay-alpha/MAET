// Nitro configuration for the MAET backend server (Render deployment).
//
// This file lives in server/ and shadows the root-level nitro.config.ts so
// that `nitro build` run from inside server/ uses only this file — not the
// root config that has `srcDir: "server"` (which would be wrong when the
// working directory is already server/).
//
// Key differences from the root nitro.config.ts:
//   - serverDir points at this directory so api/, routes/, middleware/, and
//     plugins/ are included in the production bundle.
//   - Uses "node-server" preset for Render (Node.js web service)
//   - Excludes test files from route scanning

import { defineNitroConfig } from "nitropack/config";

const config = {
  // Build output goes to server/.output/
  // render.yaml startCommand: node .output/server/index.mjs
  preset: "node-server",
  serverDir: ".",
  compatibilityDate: "2026-07-03" as const,
  alias: {
    "@shared/types/errors": "../shared/types/errors.ts",
    "@shared/types": "../shared/types/index.ts",
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
