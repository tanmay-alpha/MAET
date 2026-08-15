import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type MutableAliasRule = {
  find: string | RegExp;
  replacement: string;
};

type MutableResolvedConfig = {
  root: string;
  resolve?: { alias?: MutableAliasRule[] | MutableAliasRule };
  environments?: Record<string, { resolve?: { alias?: MutableAliasRule[] | MutableAliasRule } }>;
};

export default defineConfig({
  root: "..",
  css: { transformer: "lightningcss" },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": __dirname,
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core"
    ],
  },
  ssr: {
    external: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "use-sync-external-store/shim/with-selector"],
    ignoreOutdatedRequests: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      server: { entry: "server" },
    }),
    viteReact(),
    nitro({
      preset: process.env.MAET_NITRO_PRESET ?? "vercel",
      rootDir: ".",
      externals: {
        inline: [/^@tanstack/],
      },
    } as any),
    {
      name: "force-virtual-client-entry-and-aliases",
      config() {
        return {
          build: {
            rolldownOptions: {
              input: "virtual:tanstack-start-client-entry",
            },
          },
          appType: "custom",
        };
      },
      configResolved(config) {
        const mutableConfig = config as unknown as MutableResolvedConfig;
        const rootPath = mutableConfig.root.replace(/\\/g, "/").replace(/\/+$/, "");
        const existing = Array.isArray(mutableConfig.resolve?.alias)
          ? mutableConfig.resolve.alias
          : mutableConfig.resolve?.alias
            ? [mutableConfig.resolve.alias]
            : [];
        mutableConfig.resolve ??= {};
        const aliasRule = { find: /^@\//, replacement: `${rootPath}/src/` };
        mutableConfig.resolve.alias = [
          ...existing.filter(
            (a) =>
              !(
                typeof a === "object" &&
                a &&
                "find" in a &&
                (a.find === "@" || (a.find instanceof RegExp && a.find.source === "^@\\/"))
              ),
          ),
          aliasRule,
        ];
        
        if (mutableConfig.environments) {
          for (const key of Object.keys(mutableConfig.environments)) {
            const env = mutableConfig.environments[key];
            if (env && env.resolve) {
              const envExisting = Array.isArray(env.resolve.alias)
                ? env.resolve.alias
                : env.resolve.alias
                  ? [env.resolve.alias]
                  : [];
              env.resolve.alias = [
                ...envExisting.filter(
                  (a) =>
                    !(
                      typeof a === "object" &&
                      a &&
                      "find" in a &&
                      (a.find === "@" || (a.find instanceof RegExp && a.find.source === "^@\\/"))
                    ),
                ),
                aliasRule,
              ];
            }
          }
        }
      },
    },
  ],
});
