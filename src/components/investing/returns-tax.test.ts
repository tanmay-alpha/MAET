import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReturnsTaxSection } from "./returns-tax";

describe("Portfolio returns and tax", () => {
  it("shows the existing signed-out notice instead of fabricated returns or taxes", () => {
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReturnsTaxSection)));
    expect(markup).toContain("Returns &amp; tax");
    expect(markup).toContain("require a signed-in account");
    expect(markup).not.toContain("₹0.00");
    expect(markup).not.toContain("0.00%");
  });
});
