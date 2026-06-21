// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
    preset: "vercel",
    rootDir: ".",
  },
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
        // Vite's resolve.alias requires absolute paths — relative values
        // are "used as-is" (per https://vite.dev/config/shared-options.html).
        // vite-tsconfig-paths emits relative paths, which fail under
        // rolldown (Vite v8's bundler) when an import sits in a different
        // directory than the alias target. We register an absolute `@`
        // alias here so `@/lib/foo` resolves to `<absolute-root>/src/lib/foo`
        // regardless of which file is doing the importing.
        const rootPath = config.root.replace(/[/\\]+$/, "");
        const existing = Array.isArray(config.resolve?.alias)
          ? config.resolve.alias
          : config.resolve?.alias
            ? [config.resolve.alias]
            : [];
        config.resolve = config.resolve ?? {};
        config.resolve.alias = [
          ...existing.filter(
            (a) => !(typeof a === "object" && a && "find" in a && a.find === "@"),
          ),
          { find: "@", replacement: `${rootPath}/src` },
        ];
      },
    },
  ],
});