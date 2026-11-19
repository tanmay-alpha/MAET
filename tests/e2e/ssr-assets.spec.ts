import { test, expect } from "@playwright/test";

/**
 * The server-rendered document must reference only assets the build actually serves.
 * Its stylesheet is what styles the first paint, before any script runs, so a stylesheet
 * URL taken from the SSR build's own CSS (which nothing serves) leaves the page unstyled
 * until hydration re-renders <head>.
 */
const PATHS = ["/", "/screener", "/stock/RELIANCE"];

for (const path of PATHS) {
  test(`SSR document for ${path} references only served assets`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();

    const tags = [...html.matchAll(/<(?:link|script)\b[^>]*>/g)].map((match) => match[0]);
    const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const stylesheets = tags.filter((tag) => attr(tag, "rel") === "stylesheet").map((tag) => attr(tag, "href"));
    const assets = tags.flatMap((tag) => [attr(tag, "href"), attr(tag, "src")]).filter((url) => url?.startsWith("/assets/"));

    expect(stylesheets.filter((href) => href?.startsWith("/assets/"))).toHaveLength(1);
    for (const asset of new Set(assets)) {
      const assetResponse = await request.get(asset!);
      expect(assetResponse.status(), asset).toBe(200);
      if (asset!.endsWith(".css")) expect(assetResponse.headers()["content-type"], asset).toContain("text/css");
    }
  });
}
