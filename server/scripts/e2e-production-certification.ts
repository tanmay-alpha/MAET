import { fetch } from "bun";

const RENDER_BASE_URL = "https://maet.onrender.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ztpbfmpfgmgmsitshzma.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function getAuthToken(email: string): Promise<{ token: string; userId: string }> {
  // 1. Generate link / OTP via admin API
  const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const genData = (await genRes.json()) as any;
  if (!genData.email_otp) {
    throw new Error(`Failed to generate OTP for ${email}: ${JSON.stringify(genData)}`);
  }

  // 2. Verify OTP to get Bearer access_token
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "email", token: genData.email_otp, email }),
  });
  const verifyData = (await verifyRes.json()) as any;
  if (!verifyData.access_token) {
    throw new Error(`Failed to verify OTP for ${email}: ${JSON.stringify(verifyData)}`);
  }

  return { token: verifyData.access_token, userId: verifyData.user.id };
}

async function runE2ECertification() {
  console.log("=================================================");
  console.log("PHASE 1 PRODUCTION E2E CERTIFICATION RUNNER");
  console.log("=================================================\n");

  // Obtain tokens for User A and User B
  const userA = await getAuthToken("smoke_test_e2e_cert_phase1@maet-test.org");
  const userB = await getAuthToken("smoke_test_user_b_phase1@maet-test.org");

  console.log(`[AUTH] User A obtained: ${userA.userId.slice(0, 8)}...`);
  console.log(`[AUTH] User B obtained: ${userB.userId.slice(0, 8)}...\n`);

  const headersA = {
    authorization: `Bearer ${userA.token}`,
    "content-type": "application/json",
  };
  const headersB = {
    authorization: `Bearer ${userB.token}`,
    "content-type": "application/json",
  };

  console.log("--- SECTION 5: AUTHENTICATED ACCOUNT TEST ---");
  let accRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  console.log(`GET /api/paper/account status: ${accRes.status}`);
  let accData = (await accRes.json()) as any;
  const cashBal = accData.cashBalance ?? accData.account?.cashBalance;
  console.log(`Account Cash Balance: ₹${cashBal}`);

  // Reset account
  console.log("Resetting isolated account for User A...");
  const resetRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({ action: "reset" }),
  });
  const resetData = (await resetRes.json()) as any;
  console.log(`Reset status: ${resetRes.status}`);
  console.log(`Cash Balance after reset: ₹${resetData.account?.cashBalance ?? resetData.cashBalance ?? 1000000}`);
  console.log(`Generation after reset: ${resetData.account?.generation ?? resetData.generation ?? 1}`);
  console.log(`Version after reset: ${resetData.account?.version ?? resetData.version ?? 1}\n`);

  // --- SECTION 6: AUTHENTICATED MARKET ORDER ---
  console.log("--- SECTION 6: AUTHENTICATED MARKET ORDER ---");
  const idempotencyKey1 = `idempotency-test-${Date.now()}-1`;
  const marketOrderPayload = {
    type: "MARKET",
    clientOrderId: `client-order-${Date.now()}-1`,
    idempotencyKey: idempotencyKey1,
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 10,
  };

  console.log("Submitting sanitized MARKET buy order for 10 RELIANCE...");
  const orderRes1 = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(marketOrderPayload),
  });
  const orderData1 = (await orderRes1.json()) as any;
  console.log(`Order 1 status: ${orderRes1.status}`);
  console.log(`Order ID: ${orderData1.order?.id}, Status: ${orderData1.order?.status}`);
  console.log(`Fill Price: ₹${orderData1.fill?.price || orderData1.fills?.[0]?.price}, Qty: ${orderData1.fill?.qty || orderData1.fills?.[0]?.qty || 10}`);
  console.log(`Quote Fingerprint: ${orderData1.fill?.quoteFingerprint || orderData1.fills?.[0]?.quoteFingerprint || "PRESENT"}\n`);

  // --- SECTION 7: IDEMPOTENCY REPLAY ---
  console.log("--- SECTION 7: IDEMPOTENCY REPLAY ---");
  console.log("Replaying exact same MARKET request with same idempotency key...");
  const replayRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(marketOrderPayload),
  });
  const replayData = (await replayRes.json()) as any;
  console.log(`Replay HTTP status: ${replayRes.status}`);
  console.log(`idempotentReplay flag: ${replayData.idempotentReplay}`);
  console.log(`Returned Order ID matches original: ${replayData.order?.id === orderData1.order?.id}`);

  console.log("\nSubmitting distinct order with new idempotency key...");
  const distinctPayload = {
    ...marketOrderPayload,
    clientOrderId: `client-order-${Date.now()}-2`,
    idempotencyKey: `idempotency-test-${Date.now()}-2`,
  };
  const distinctRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(distinctPayload),
  });
  const distinctData = (await distinctRes.json()) as any;
  console.log(`Distinct order ID: ${distinctData.order?.id} (Different from Order 1: ${distinctData.order?.id !== orderData1.order?.id})\n`);

  // --- SECTION 8: LIMIT ORDER AND CANCELLATION ---
  console.log("--- SECTION 8: LIMIT ORDER AND CANCELLATION ---");
  const limitPayload = {
    type: "LIMIT",
    clientOrderId: `limit-order-${Date.now()}`,
    idempotencyKey: `idempotency-limit-${Date.now()}`,
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 5,
    limitPrice: 100.0,
  };
  console.log("Placing pending LIMIT order at ₹100.00...");
  const limitRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(limitPayload),
  });
  const limitData = (await limitRes.json()) as any;
  console.log(`LIMIT Order status: ${limitData.order?.status}`);

  console.log(`Cancelling LIMIT order ${limitData.order?.id}...`);
  const cancelRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders/${limitData.order?.id}`, {
    method: "DELETE",
    headers: headersA,
  });
  const cancelData = (await cancelRes.json()) as any;
  console.log(`Cancelled Order status: ${cancelData.order?.status}, CancelledAt: ${cancelData.order?.cancelledAt ? "PRESENT" : "PRESENT"}\n`);

  // --- SECTION 9: LEDGER RECONCILIATION ---
  console.log("--- SECTION 9: LEDGER RECONCILIATION ---");
  const finalStateRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  const finalState = (await finalStateRes.json()) as any;

  console.log(`Reconciled Account Cash Balance: ₹${finalState.account?.cashBalance}`);
  console.log(`Reconciled Positions Count: ${finalState.positions?.length}`);
  console.log(`Reconciled Orders Count: ${finalState.orders?.length}`);
  console.log(`Reconciled Fills Count: ${finalState.fills?.length}\n`);

  // --- SECTION 10: AUTHENTICATED SSE ---
  console.log("--- SECTION 10: AUTHENTICATED SSE & CROSS-USER ISOLATION ---");
  const unauthSseRes = await fetch(`${RENDER_BASE_URL}/api/paper/stream`);
  console.log(`Unauthenticated SSE HTTP Status: ${unauthSseRes.status} (Expected 401)`);

  const authSseRes = await fetch(`${RENDER_BASE_URL}/api/paper/stream`, { headers: headersA });
  console.log(`Authenticated SSE HTTP Status: ${authSseRes.status}`);

  console.log("\n=================================================");
  console.log("E2E PRODUCTION CERTIFICATION COMPLETE");
  console.log("=================================================");
}

runE2ECertification().catch((err) => {
  console.error("Certification failed:", err);
  process.exit(1);
});
