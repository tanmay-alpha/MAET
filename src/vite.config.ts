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
  // Start starter layout.
  vite: {
    root: "..",
    // Explicit alias for `@/*` → `<root>/src/*`. The lovable config already
    // wires up vite-tsconfig-paths, but vite-tsconfig-paths only resolves
    // paths declared in tsconfig.json. Since our tsconfig.json is at the
    // project root and our vite root is the project root, the paths should
    // resolve — but rolldown (Vite v8's bundler) has stricter path handling
    // than rollup and ignores vite-tsconfig-paths' resolved id for some
    // importers. Declaring the alias directly here makes it work for both.
    resolve: {
      alias: { "@": `${process.cwd().replace(/\\src$/, "")}/src` },
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
    preset: "vercel",
    rootDir: ".",
  },
  // Inline plugin that runs in the config() chain. It force-injects the
  // virtual TanStack Start client entry into the resolved top-level
  // `build.rolldownOptions.input` so rolldown doesn't fall back to the SPA
  // shell lookup ("[UNRESOLVED_ENTRY] Cannot resolve entry module index.html")
  // when Nitro's `builder.sharedConfigBuild: true` flag causes Vite to skip
  // the per-environment build hoist.
  plugins: [
    {
      name: "force-virtual-client-entry",
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
    },
  ],
});