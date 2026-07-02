import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import serverEntry from "@tanstack/react-start/server-entry";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Enhanced error capture for SSR failures
const ERROR_MESSAGES = [
  "Server Error",
  "Internal Server Error",
  "HTTPError",
  "unhandled",
  "Cannot read properties",
  "is not defined",
  "Module not found",
];

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  const isSSRError = ERROR_MESSAGES.some(msg => body.includes(msg));

  if (isSSRError) {
    console.error(consumeLastCapturedError() ?? new Error(`SSR error detected: ${body.substring(0, 200)}`));
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return response;
}

// Fallback error page for catastrophic failures
function renderFallbackError(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Service Unavailable</title>
      <style>
        body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
        .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 1rem; }
        p { color: #666; margin-bottom: 1.5rem; }
        .retry { display: inline-block; padding: 0.75rem 1.5rem; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Service Temporarily Unavailable</h1>
        <p>We're experiencing technical difficulties. Please try again later.</p>
        <a href="/" class="retry">Go to Homepage</a>
      </div>
    </body>
    </html>
  `;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const response = await (serverEntry as ServerEntry).fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderFallbackError(), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
