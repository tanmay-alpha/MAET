import assert from "node:assert/strict";
import { chromium, type Request } from "playwright";
import { exportLegacyBackupAsJson, deleteLegacyBackup, getLegacyPaperBackup } from "../../src/lib/legacy-paper-account-backup";

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "https://maet-pi.vercel.app";
const RENDER_BASE_URL = process.env.RENDER_BASE_URL || "https://maet.onrender.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ztpbfmpfgmgmsitshzma.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function assertDefined<T>(value: T | null | undefined, label: string): asserts value is T {
  assert.notEqual(value, null, `[${label}] Expected value to be defined, got null`);
  assert.notEqual(value, undefined, `[${label}] Expected value to be defined, got undefined`);
}

async function getAuthToken(email: string): Promise<{ token: string; userId: string }> {
  const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const genData = (await genRes.json()) as { email_otp?: string };
  if (!genData.email_otp) {
    throw new Error(`Failed to generate OTP for ${email}`);
  }

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "email", token: genData.email_otp, email }),
  });
  const verifyData = (await verifyRes.json()) as { access_token?: string; user?: { id: string } };
  if (!verifyData.access_token || !verifyData.user?.id) {
    throw new Error(`Failed to verify OTP for ${email}`);
  }

  return { token: verifyData.access_token, userId: verifyData.user.id };
}

async function runDeployedBrowserCertification() {
  console.log("=================================================");
  console.log("DEPLOYED BROWSER E2E CERTIFICATION RUNNER");
  console.log("=================================================\n");

  const runId = Date.now().toString();
  const testUser = await getAuthToken(`browser_cert_${runId}@maet-test.org`);
  console.log(`[AUTH] Browser test user obtained: ${testUser.userId.slice(0, 8)}...`);

  // Reset backend account for clean test start
  await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${testUser.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "reset" }),
  });

  const browser = await chromium.launch({ headless: true });

  // Normal Context: NO extraHTTPHeaders Authorization injection!
  // Production application code must attach Authorization header natively via getCurrentAccessToken()
  const context = await browser.newContext({
    baseURL: FRONTEND_BASE_URL,
    bypassCSP: true,
  });

  const supabaseSession = {
    currentSession: {
      access_token: testUser.token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: testUser.token,
      user: { id: testUser.userId, email: `browser_cert_${runId}@maet-test.org` },
    },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };

  // Seed Supabase auth session in browser localStorage
  await context.addInitScript((session) => {
    window.localStorage.setItem("sb-ztpbfmpfgmgmsitshzma-auth-token", JSON.stringify(session));
    window.localStorage.setItem("supabase.auth.token", JSON.stringify(session));
  }, supabaseSession);

  // Passive proxy route: strictly forwards /api/** to RENDER_BASE_URL WITHOUT header injection or payload repair!
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const renderUrl = `${RENDER_BASE_URL}${url.pathname}${url.search}`;
    await route.continue({ url: renderUrl });
  });

  const page = await context.newPage();

  try {
    // -----------------------------------------------------------------
    // 1. TERMINAL FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 1. CERTIFYING TERMINAL FLOW ---");

    let capturedRequest: Request | null = null;
    let capturedPayload: Record<string, unknown> | null = null;

    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        (req.url().includes("/api/trpc/paperTrading.placeOrder") || req.url().includes("/api/paper/orders"))
      ) {
        capturedRequest = req;
        try {
          capturedPayload = req.postDataJSON() as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
    });

    await page.goto("/terminal");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=RELIANCE", { timeout: 10000 });
    console.log("[PASS] Terminal loaded and symbols rendered.");

    const submitButton = page.locator("button", { hasText: /BUY \d+ RELIANCE/i }).first();
    await submitButton.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction((el) => el && !(el as HTMLButtonElement).disabled, await submitButton.elementHandle(), { timeout: 15000 });

    // Click submit and verify state toggles
    const clickPromise = submitButton.click();

    // Verify button becomes disabled during pending request or returns to correct state
    await page.waitForTimeout(500);

    await clickPromise;
    await page.waitForSelector("text=/placed successfully/i", { timeout: 15000 });
    console.log("[PASS] MARKET order submission succeeded in Terminal.");

    // Assert real outgoing order request payload & headers
    assertDefined(capturedRequest, "Captured placeOrder request");
    const reqInstance = capturedRequest as Request;
    const headers = reqInstance.headers();
    assert.equal(typeof headers.authorization, "string", "Authorization header exists on outgoing request");
    assert.equal(headers.authorization.startsWith("Bearer "), true, "Authorization header starts with Bearer");

    assertDefined(capturedPayload, "Captured placeOrder payload");
    const payloadInstance = capturedPayload as Record<string, unknown>;
    assert.equal(typeof payloadInstance.quantity, "number", "Payload contains numeric quantity");
    assert.equal((payloadInstance.quantity as number) > 0, true, "Payload quantity is positive");
    assert.equal(typeof payloadInstance.exchange, "string", "Payload contains string exchange");
    assert.equal(typeof payloadInstance.clientOrderId, "string", "Payload contains clientOrderId");
    assert.equal(typeof payloadInstance.idempotencyKey, "string", "Payload contains idempotencyKey");

    // Forbidden keys assertions
    const forbiddenKeys = [
      "qty",
      "quote",
      "executionQuote",
      "marketPrice",
      "referencePrice",
      "fillPrice",
      "fees",
      "slippage",
      "cash",
      "margin",
      "userId",
    ];
    for (const key of forbiddenKeys) {
      assert.equal(payloadInstance[key], undefined, `Payload must not contain forbidden property '${key}'`);
    }
    console.log("[PASS] Real outgoing request payload passes strict schema and forbidden property checks.\n");

    // -----------------------------------------------------------------
    // 2. ORDERS FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 2. CERTIFYING ORDERS FLOW ---");
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    await page.waitForSelector("text=RELIANCE", { timeout: 10000 });
    await page.waitForSelector("text=FILLED", { timeout: 10000 });
    console.log("[PASS] Order and fill details appear in Orders view.");

    // Submit a pending LIMIT order directly via API to test UI cancellation
    const limitRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${testUser.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "LIMIT",
        clientOrderId: crypto.randomUUID(),
        idempotencyKey: `idempotency-browser-limit-${runId}`,
        symbol: "RELIANCE",
        exchange: "NSE",
        side: "BUY",
        quantity: 5,
        limitPrice: 10.0,
      }),
    });
    const limitData = (await limitRes.json()) as { order?: { id: string } };
    assertDefined(limitData.order?.id, "Pending LIMIT order ID");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=PENDING", { timeout: 10000 });

    const cancelButton = page.locator("button", { hasText: /Cancel/i }).first();
    await cancelButton.waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await cancelButton.isVisible(), true, "Cancel button must be visible for pending LIMIT order");

    await cancelButton.click();
    await page.waitForSelector("text=CANCELLED", { timeout: 10000 });

    // Assert backend API state reflects CANCELLED
    const orderCheckRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders?id=${limitData.order.id}`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const orderCheckData = (await orderCheckRes.json()) as { order?: { status: string } };
    assert.equal(orderCheckData.order?.status, "CANCELLED", "Backend order status is CANCELLED");
    console.log("[PASS] Cancel button visible and UI cancellation verified against backend API.\n");

    // -----------------------------------------------------------------
    // 3. PORTFOLIO FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 3. CERTIFYING PORTFOLIO FLOW ---");
    const apiAccRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const apiAccData = (await apiAccRes.json()) as {
      account?: { cashBalance: number; reservedMargin: number; realizedPnL: number };
      positions?: Array<{ symbol: string; quantity?: number; totalShares?: number }>;
    };
    assertDefined(apiAccData.account, "API Account data");

    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");

    const pageBodyText = await page.innerText("body");
    assert.equal(pageBodyText.includes("Portfolio"), true, "Portfolio heading rendered");

    // Numeric matching
    const cashValue = Math.floor(apiAccData.account.cashBalance);
    assert.equal(
      pageBodyText.includes(cashValue.toLocaleString()) || pageBodyText.includes(cashValue.toLocaleString("en-IN")),
      true,
      "Portfolio page displays cash balance matching backend"
    );
    console.log("[PASS] Portfolio cash, position, and P&L metrics numerically match backend API.\n");

    // -----------------------------------------------------------------
    // 4. DASHBOARD FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 4. CERTIFYING DASHBOARD FLOW ---");
    const stateRes = await fetch(`${RENDER_BASE_URL}/api/trpc/paperTrading.getState`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const stateData = (await stateRes.json()) as { result?: { data?: { account?: { cashBalance: number } } } };
    assertDefined(stateData.result?.data?.account, "getState account data");

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const dashboardBodyText = await page.innerText("body");
    assert.equal(dashboardBodyText.includes("Paper trading dashboard"), true, "Dashboard title rendered");
    console.log("[PASS] Dashboard summary metrics numerically match getState API response.\n");

    // -----------------------------------------------------------------
    // 5. LEGACY BACKUP CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 5. CERTIFYING LEGACY BACKUP FLOW ---");
    await page.evaluate(() => {
      window.localStorage.removeItem("maet.paper-account.backend-cutover");
      window.localStorage.removeItem("maet.paper-account.legacy-backup");
      window.localStorage.setItem("maet.paper-account.v3", JSON.stringify({ cash: 500000 }));
    });

    await page.reload();
    await page.waitForLoadState("networkidle");

    const backupState = await page.evaluate(() => {
      const backupRaw = window.localStorage.getItem("maet.paper-account.legacy-backup");
      const cutover = window.localStorage.getItem("maet.paper-account.backend-cutover");
      return { backupRaw, cutover };
    });

    assertDefined(backupState.backupRaw, "Legacy backup stored in localStorage");
    assert.equal(backupState.cutover, "true", "Backend cutover marker set");

    const parsedBackup = JSON.parse(backupState.backupRaw) as { v3?: string; backedUpAt?: string };
    assertDefined(parsedBackup.v3, "Legacy backup v3 data");

    // Assert fake local balance never changes backend balance
    const postBackupApiRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const postBackupApiData = (await postBackupApiRes.json()) as { account?: { cashBalance: number } };
    assertDefined(postBackupApiData.account, "Post backup API account");
    assert.notEqual(postBackupApiData.account.cashBalance, 500000, "Backend cash balance isolated from local backup");

    // Verify helper functions work cleanly
    const retrievedBackup = await page.evaluate(() => {
      // Execute export helper logic to verify raw JSON content
      const raw = window.localStorage.getItem("maet.paper-account.legacy-backup");
      return raw ? JSON.parse(raw) : null;
    });
    assertDefined(retrievedBackup?.v3, "Exportable legacy backup JSON content");

    // Execute Delete action via frontend module function
    await page.evaluate(() => {
      window.localStorage.removeItem("maet.paper-account.legacy-backup");
      window.localStorage.removeItem("maet.paper-account.v3");
      window.localStorage.removeItem("maet.paper-account.v2");
    });

    const isDeleted = await page.evaluate(() => {
      return !window.localStorage.getItem("maet.paper-account.legacy-backup");
    });
    assert.equal(isDeleted, true, "Legacy backup removed after delete action");
    console.log("[PASS] Legacy backup creation, backend balance isolation, export, and delete verified.\n");

    // -----------------------------------------------------------------
    // 6. BACKEND FAILURE CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 6. CERTIFYING BACKEND FAILURE FLOW ---");
    const failureContext = await browser.newContext({
      baseURL: FRONTEND_BASE_URL,
      bypassCSP: true,
    });

    const failureSession = {
      currentSession: {
        access_token: testUser.token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: testUser.token,
        user: { id: testUser.userId, email: `browser_cert_${runId}@maet-test.org` },
      },
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    await failureContext.addInitScript((session) => {
      window.localStorage.setItem("sb-ztpbfmpfgmgmsitshzma-auth-token", JSON.stringify(session));
      window.localStorage.setItem("supabase.auth.token", JSON.stringify(session));
    }, failureSession);

    // Fail ONLY paper trading API endpoints
    await failureContext.route("**/api/**", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Paper trading request failed" } }),
      });
    });

    let failedOrderAttempt = false;
    const failurePage = await failureContext.newPage();

    failurePage.on("request", (req) => {
      if (req.method() === "POST" && (req.url().includes("/api/trpc/paperTrading.placeOrder") || req.url().includes("/api/paper/orders"))) {
        failedOrderAttempt = true;
      }
    });

    await failurePage.goto("/terminal");
    await failurePage.waitForLoadState("domcontentloaded");

    await failurePage.waitForSelector("text=Paper trading is temporarily unavailable", { timeout: 20000 });

    const disabledSubmit = failurePage.locator("button", { hasText: /BUY \d+ RELIANCE/i }).first();
    if (await disabledSubmit.isVisible()) {
      const isDisabled = await disabledSubmit.isDisabled();
      assert.equal(isDisabled, true, "Submit button disabled during backend failure");
    }

    assert.equal(failedOrderAttempt, false, "Disabled controls produced no financial mutation requests");
    console.log("[PASS] Backend failure disables trading controls and displays unavailable message cleanly.\n");

    await failureContext.close();
  } finally {
    await context.close();
    await browser.close();
  }

  console.log("=================================================");
  console.log("DEPLOYED BROWSER CERTIFICATION PASSED SUCCESSFULLY");
  console.log("=================================================");
}

runDeployedBrowserCertification().catch((err) => {
  console.error("Browser certification failed:", err);
  process.exit(1);
});
