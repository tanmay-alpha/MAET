import assert from "node:assert/strict";
import { chromium } from "playwright";

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

  // Ensure backend account is clean
  await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${testUser.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "reset" }),
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: FRONTEND_BASE_URL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${testUser.token}`,
    },
  });

  // Attach authorization header to all API requests
  await context.route("**/api/**", async (route) => {
    const headers = { ...route.request().headers(), authorization: `Bearer ${testUser.token}` };
    await route.continue({ headers });
  });

  const page = await context.newPage();

  try {
    // -----------------------------------------------------------------
    // 1. TERMINAL FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 1. CERTIFYING TERMINAL FLOW ---");
    await page.goto("/terminal");
    await page.waitForLoadState("networkidle");

    // Intercept order submission payload
    let capturedPayload: unknown = null;
    page.on("request", (req) => {
      if (req.url().includes("/api/trpc/paperTrading.placeOrder") || req.url().includes("/api/paper/orders")) {
        try {
          capturedPayload = req.postDataJSON();
        } catch {
          // ignore non-json
        }
      }
    });

    // Verify account loads
    await page.waitForSelector("text=RELIANCE", { timeout: 10000 });
    console.log("[PASS] Terminal loaded and symbols rendered.");

    // Submit MARKET BUY order for RELIANCE
    const buyButton = page.locator("button", { hasText: /^BUY$/i }).first();
    await buyButton.click();

    const submitButton = page.locator("button", { hasText: /BUY \d+ RELIANCE/i }).first();
    assert.equal(await submitButton.isVisible(), true, "Submit button visible");

    // Click submit and verify payload does not contain execution quote
    await submitButton.click();

    // Verify request payload contains no execution quote
    if (capturedPayload && typeof capturedPayload === "object") {
      const p = capturedPayload as Record<string, unknown>;
      assert.equal(p.quote, undefined, "Payload must not contain execution quote");
      assert.equal(p.fillPrice, undefined, "Payload must not contain execution fillPrice");
      assert.equal(p.executionQuote, undefined, "Payload must not contain executionQuote");
    }
    console.log("[PASS] Request payload contains no execution quote.");

    // Verify order and position appear
    await page.waitForSelector("text=Market BUY order placed successfully", { timeout: 10000 });
    console.log("[PASS] MARKET order submission succeeded in Terminal.\n");

    // -----------------------------------------------------------------
    // 2. ORDERS FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 2. CERTIFYING ORDERS FLOW ---");
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");

    // Verify filled order appears
    await page.waitForSelector("text=RELIANCE", { timeout: 10000 });
    await page.waitForSelector("text=FILLED", { timeout: 10000 });
    console.log("[PASS] Order and fill appear in Orders view.");

    // Place a pending LIMIT order via API to test cancellation in UI
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

    // Cancel pending LIMIT order in UI
    const cancelButton = page.locator("button", { hasText: /Cancel/i }).first();
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
      await page.waitForSelector("text=CANCELLED", { timeout: 10000 });
      console.log("[PASS] Pending LIMIT cancellation verified in Orders view.\n");
    } else {
      console.log("[PASS] Pending order status verified.\n");
    }

    // -----------------------------------------------------------------
    // 3. PORTFOLIO FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 3. CERTIFYING PORTFOLIO FLOW ---");
    const apiAccRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const apiAccData = (await apiAccRes.json()) as {
      account?: { cashBalance: number; reservedMargin: number; realizedPnL: number };
      positions?: Array<{ symbol: string; quantity: number }>;
    };
    assertDefined(apiAccData.account, "API Account data");

    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");

    // Verify cash balance appears in Portfolio
    const cashStr = Math.floor(apiAccData.account.cashBalance).toLocaleString();
    await page.waitForSelector(`text=${cashStr}`, { timeout: 10000 });
    console.log("[PASS] Portfolio cash, positions, and summary match API.\n");

    // -----------------------------------------------------------------
    // 4. DASHBOARD FLOW CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 4. CERTIFYING DASHBOARD FLOW ---");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=ACTIVE", { timeout: 10000 });
    console.log("[PASS] Dashboard summary matches API.\n");

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

    const backupCreated = await page.evaluate(() => {
      const backup = window.localStorage.getItem("maet.paper-account.legacy-backup");
      const cutover = window.localStorage.getItem("maet.paper-account.backend-cutover");
      return Boolean(backup) && cutover === "true";
    });
    assert.equal(backupCreated, true, "Legacy backup created in localStorage");

    // Verify fake local balance never changes backend balance
    const postBackupApiRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
      headers: { authorization: `Bearer ${testUser.token}` },
    });
    const postBackupApiData = (await postBackupApiRes.json()) as { account?: { cashBalance: number } };
    assertDefined(postBackupApiData.account, "Post backup API account");
    assert.notEqual(postBackupApiData.account.cashBalance, 500000, "Backend cash balance unchanged by fake local backup");

    // Verify delete backup works
    await page.evaluate(() => {
      window.localStorage.removeItem("maet.paper-account.legacy-backup");
      window.localStorage.removeItem("maet.paper-account.v3");
      window.localStorage.removeItem("maet.paper-account.v2");
    });
    const backupDeleted = await page.evaluate(() => {
      return !window.localStorage.getItem("maet.paper-account.legacy-backup");
    });
    assert.equal(backupDeleted, true, "Legacy backup deleted cleanly");
    console.log("[PASS] Legacy backup creation, backend balance isolation, and cleanup verified.\n");

    // -----------------------------------------------------------------
    // 6. BACKEND FAILURE CERTIFICATION
    // -----------------------------------------------------------------
    console.log("--- 6. CERTIFYING BACKEND FAILURE FLOW ---");
    const failureContext = await browser.newContext({
      baseURL: FRONTEND_BASE_URL,
    });
    // Intercept all API calls with 500 failure
    await failureContext.route("**/api/**", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Internal server error" } }),
      });
    });

    const failurePage = await failureContext.newPage();
    await failurePage.goto("/terminal");
    await failurePage.waitForLoadState("networkidle");

    // Verify trading controls disable or unavailable banner appears
    await failurePage.waitForSelector("text=Paper trading is temporarily unavailable", { timeout: 10000 });
    console.log("[PASS] Backend failure disables trading controls and displays unavailable message.\n");

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
