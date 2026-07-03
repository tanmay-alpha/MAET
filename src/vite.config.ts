import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
  // Set vite root to the project root (the directory above src/). This
  // lets TanStack Start's default srcDirectory: "src" resolve to src/
  // (routes, router, server.ts, etc.) — same as the official TanStack
  // Start starter layout. We rely on the inline plugin below (in
  // `plugins: [...]`) to set the `@/*` → absolute path alias in
  // configResolved, since the alias needs the resolved absolute root and
  // vite's resolve.alias requires absolute paths.
  vite: {
    root: "..",
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@": __dirname,
      },
    },
    // The Vite root is the workspace root, so React is also declared there.
    // Keeping it external lets Node load its CommonJS entry correctly during
    // local SSR instead of evaluating it as native ESM (`module` undefined).
    ssr: {
      external: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["use-sync-external-store/shim/with-selector"],
    },
  },
  // TanStack Start plugin options.
  // - server.entry: "server" so Nitro builds from src/server.ts (our SSR
  //   error wrapper) instead of the bundled default.
  tanstackStart: {
    server: { entry: "server" },
  },
  // Force nitro to use the Vercel preset. The Lovable config defaults to
  // cloudflare-module which only emits a Cloudflare Workers bundle and doesn't
  // produce the .vercel/output structure Vercel needs. We also pass an
  // explicit `rootDir: "."` so the Nitro plugin doesn't try to load the
  // legacy `nitro.config.ts` at the project root (which uses the old
  // `nitropack/config` API incompatible with Nitro v3).
  nitro: {
    preset: process.env.MAET_NITRO_PRESET ?? "vercel",
    rootDir: ".",
    externals: {
      inline: [
        /^@tanstack/,
      ],
    },
  } as unknown as { preset: string },
  // Inline plugin that runs in the config() chain. Two responsibilities:
//   1. Inject the virtual TanStack Start client entry as the resolved
//      top-level `build.rolldownOptions.input` so rolldown doesn't fall
//      back to the SPA shell lookup ("[UNRESOLVED_ENTRY] Cannot resolve
//      entry module index.html") when Nitro's
//      `builder.sharedConfigBuild: true` flag causes Vite to skip the
//      per-environment build hoist.
//   2. Register the `@/*` → `<root>/src/*` alias at configResolved time
//      (not at config() time) so we have access to the resolved vite
//      root path. vite-tsconfig-paths handles `@/*` from tsconfig.json in
//      most cases, but rolldown (Vite v8's bundler) is stricter and skips
//      some of its resolved ids. Adding the alias here makes it work for
//      both rolldown and rollup.
  plugins: [
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
        // Vite's resolve.alias requires absolute paths — relative values
        // are "used as-is" (per https://vite.dev/config/shared-options.html).
        // vite-tsconfig-paths emits relative paths, which fail under
        // rolldown (Vite v8's bundler) when an import sits in a different
        // directory than the alias target. We register an absolute `@`
        // alias here so `@/lib/foo` resolves to `<absolute-root>/src/lib/foo`
        // regardless of which file is doing the importing.
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
        
        // Vite 8 Environment resolution support
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
        console.log("VITE_RESOLVED_ALIASES:", JSON.stringify(mutableConfig.resolve.alias));
      },
    },
  ],
});
