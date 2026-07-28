import assert from "node:assert/strict";

const RENDER_BASE_URL = process.env.RENDER_BASE_URL || "https://maet.onrender.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ztpbfmpfgmgmsitshzma.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function assertHttpStatus(res: Response, expected: number, label: string): void {
  assert.equal(res.status, expected, `[${label}] Expected HTTP status ${expected}, got ${res.status}`);
}

async function readJsonOrThrow<T = unknown>(res: Response, label: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new Error(`[${label}] Failed to parse JSON body: ${String(err)}`);
  }
}

function assertDefined<T>(value: T | null | undefined, label: string): asserts value is T {
  assert.notEqual(value, null, `[${label}] Expected value to be defined, got null`);
  assert.notEqual(value, undefined, `[${label}] Expected value to be defined, got undefined`);
}

function assertFiniteMoney(value: unknown, label: string): void {
  assert.equal(typeof value, "number", `[${label}] Expected money to be number, got ${typeof value}`);
  assert.equal(Number.isFinite(value as number), true, `[${label}] Expected money to be finite, got ${value}`);
  assert.equal(Number.isNaN(value as number), false, `[${label}] Expected money not to be NaN`);
}

async function assertEventually<T>(
  operation: () => Promise<T>,
  predicate: (result: T) => boolean,
  timeoutMs: number,
  label: string
): Promise<T> {
  const start = Date.now();
  let lastResult: T | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await operation();
      lastResult = res;
      if (predicate(res)) {
        return res;
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `[${label}] Condition not satisfied within ${timeoutMs}ms. Last result: ${JSON.stringify(lastResult)}`
  );
}

interface AccountObject {
  id: string;
  userId: string;
  status: string;
  currency: string;
  generation: number;
  version: number;
  cashBalance: number;
  reservedMargin: number;
  realizedPnL: number;
  unrealizedPnL: number;
}

interface PositionObject {
  id: string;
  symbol: string;
  exchange: string;
  quantity: number;
  averagePrice: number;
  generation: number;
}

interface OrderObject {
  id: string;
  clientOrderId?: string;
  idempotencyKey?: string;
  symbol: string;
  exchange: string;
  side: string;
  type: string;
  qty: number;
  quantity?: number;
  status: string;
  limitPrice?: number;
  stopPrice?: number;
  cancelledAt?: string;
  generation: number;
}

interface FillObject {
  id: string;
  orderId: string;
  qty: number;
  fillPrice: number;
  quoteSource: string;
  quoteQuality: string;
  quoteTimestamp: string;
  quoteFingerprint: string;
  generation: number;
}

interface LedgerObject {
  id: string;
  type: string;
  amount: number;
  orderId?: string;
  fillId?: string;
  generation: number;
}

interface AccountApiResponse {
  success?: boolean;
  account?: AccountObject;
  cashBalance?: number;
  generation?: number;
  version?: number;
  status?: string;
  positions?: PositionObject[];
  orders?: OrderObject[];
  fills?: FillObject[];
  ledger?: LedgerObject[];
}

interface OrderPostApiResponse {
  success: boolean;
  order?: OrderObject;
  fill?: FillObject;
  fills?: FillObject[];
  account?: AccountObject;
  position?: PositionObject;
  idempotentReplay?: boolean;
  asOf?: string;
}

interface OrderDeleteApiResponse {
  success: boolean;
  order?: OrderObject;
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
  const genData = await readJsonOrThrow<{ email_otp?: string }>(genRes, "auth generate_link");
  if (!genData.email_otp) {
    throw new Error(`Failed to generate OTP for user`);
  }

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "email", token: genData.email_otp, email }),
  });
  const verifyData = await readJsonOrThrow<{ access_token?: string; user?: { id: string } }>(
    verifyRes,
    "auth verify"
  );
  if (!verifyData.access_token || !verifyData.user?.id) {
    throw new Error(`Failed to verify OTP for user`);
  }

  return { token: verifyData.access_token, userId: verifyData.user.id };
}

async function runE2ECertification() {
  console.log("=================================================");
  console.log("PHASE 1 PRODUCTION E2E CERTIFICATION RUNNER");
  console.log("=================================================\n");

  const runId = Date.now().toString();
  const userA = await getAuthToken(`smoke_test_e2e_cert_phase1_${runId}@maet-test.org`);
  const userB = await getAuthToken(`smoke_test_user_b_phase1_${runId}@maet-test.org`);

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

  // --- SECTION 5: ACCOUNT ASSERTIONS ---
  console.log("--- SECTION 5: AUTHENTICATED ACCOUNT ASSERTIONS ---");
  const initialAccRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  assertHttpStatus(initialAccRes, 200, "Account GET initial");
  const initialAccData = await readJsonOrThrow<AccountApiResponse>(initialAccRes, "Account GET initial");

  assertDefined(initialAccData.account, "Account GET account object");
  assert.equal(initialAccData.account.status, "ACTIVE", "Initial account status must be ACTIVE");
  assert.equal(initialAccData.account.currency, "INR", "Initial account currency must be INR");
  assert.equal(Number.isInteger(initialAccData.account.generation) && initialAccData.account.generation > 0, true, "Generation positive int");
  assert.equal(Number.isInteger(initialAccData.account.version) && initialAccData.account.version > 0, true, "Version positive int");
  assertFiniteMoney(initialAccData.account.cashBalance, "Initial cash balance");

  const preResetGen = initialAccData.account.generation;
  const preResetVer = initialAccData.account.version;

  console.log("Resetting account for User A...");
  const resetRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({ action: "reset" }),
  });
  assertHttpStatus(resetRes, 200, "Account RESET");
  const resetData = await readJsonOrThrow<AccountApiResponse>(resetRes, "Account RESET");

  assertDefined(resetData.account, "Account RESET account object");
  assert.equal(Number(resetData.account.cashBalance), 1000000, "Cash balance after reset must be exactly 1000000");
  assert.equal(resetData.account.status, "ACTIVE", "Status after reset must be ACTIVE");
  assert.equal(resetData.account.generation > preResetGen, true, "Generation must increase after reset");
  assert.equal(resetData.account.version > preResetVer, true, "Version must increase after reset");
  console.log(`[PASS] Account GET and RESET assertions verified.\n`);

  // --- SECTION 6: MARKET ORDER ASSERTIONS ---
  console.log("--- SECTION 6: AUTHENTICATED MARKET ORDER ASSERTIONS ---");
  const marketClientOrderId = crypto.randomUUID();
  const idempotencyKey1 = `idempotency-${runId}-mkt-1`;
  const marketOrderPayload = {
    type: "MARKET",
    clientOrderId: marketClientOrderId,
    idempotencyKey: idempotencyKey1,
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 10,
  };

  const postVerStart = resetData.account.version;
  const orderRes1 = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(marketOrderPayload),
  });
  assertHttpStatus(orderRes1, 200, "Market order submission");
  const orderData1 = await readJsonOrThrow<OrderPostApiResponse>(orderRes1, "Market order submission");

  assertDefined(orderData1.order?.id, "Market order ID");
  assert.equal(
    orderData1.order.status === "FILLED" || orderData1.order.status === "PARTIALLY_FILLED",
    true,
    `Order status must be FILLED or PARTIALLY_FILLED, got ${orderData1.order.status}`
  );

  const fillObj = orderData1.fill || orderData1.fills?.[0];
  assertDefined(fillObj, "Market fill object");
  assertDefined(fillObj.id, "Fill ID");
  assert.equal(fillObj.qty > 0, true, "Fill quantity > 0");
  assert.equal(fillObj.fillPrice > 0, true, "Fill price > 0");
  assert.equal(Boolean(fillObj.quoteSource), true, "Quote source exists");
  assert.equal(Boolean(fillObj.quoteQuality), true, "Quote quality exists");
  assert.equal(Number.isNaN(Date.parse(fillObj.quoteTimestamp)), false, "Quote timestamp valid");
  assert.equal(/^[a-f0-9]{64}$/.test(fillObj.quoteFingerprint), true, "Quote fingerprint format");

  assertDefined(orderData1.account, "Response account object");
  assert.equal(orderData1.account.version > postVerStart, true, "Account version increased");

  // Query authoritative state after submission
  const stateRes1 = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  assertHttpStatus(stateRes1, 200, "State query post market order");
  const state1 = await readJsonOrThrow<AccountApiResponse>(stateRes1, "State query post market order");

  const newOrders = (state1.orders || []).filter((o) => o.id === orderData1.order!.id);
  assert.equal(newOrders.length, 1, "Exactly one new order in state");
  const newFills = (state1.fills || []).filter((f) => f.orderId === orderData1.order!.id);
  assert.equal(newFills.length, 1, "Exactly one corresponding fill for that order");

  const positionMatch = (state1.positions || []).find((p) => p.symbol === "RELIANCE");
  assertDefined(positionMatch, "Position for RELIANCE");
  assert.equal(positionMatch.quantity, 10, "Position quantity matches order");

  const ledgerForOrder = (state1.ledger || []).filter(
    (l: any) => l.fillId === orderData1.fill!.id || l.sourceId === orderData1.order!.id || l.metadata?.orderId === orderData1.order!.id
  );
  assert.equal(ledgerForOrder.length > 0, true, "Ledger contains financial entries for order");
  console.log(`[PASS] Market order and fill assertions verified.\n`);

  // --- SECTION 7: IDEMPOTENCY ASSERTIONS ---
  console.log("--- SECTION 7: IDEMPOTENCY ASSERTIONS ---");
  const replayRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(marketOrderPayload),
  });
  assertHttpStatus(replayRes, 200, "Idempotency replay POST");
  const replayData = await readJsonOrThrow<OrderPostApiResponse>(replayRes, "Idempotency replay POST");

  assert.equal(replayData.idempotentReplay, true, "idempotentReplay must be true");
  assert.equal(replayData.order?.id, orderData1.order!.id, "Replay order ID equals original order ID");

  const stateRes2 = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  const state2 = await readJsonOrThrow<AccountApiResponse>(stateRes2, "State query post replay");

  const orderCountForIdem = (state2.orders || []).filter((o) => o.idempotencyKey === idempotencyKey1).length;
  assert.equal(orderCountForIdem, 1, "Order count for idempotency key unchanged");
  const fillCountForOrder = (state2.fills || []).filter((f) => f.orderId === orderData1.order!.id).length;
  assert.equal(fillCountForOrder, 1, "Fill count for order unchanged by replay");
  const ledgerCountForOrder = (state2.ledger || []).filter(
    (l: any) => l.fillId === orderData1.fill!.id || l.sourceId === orderData1.order!.id || l.metadata?.orderId === orderData1.order!.id
  ).length;
  assert.equal(ledgerCountForOrder, ledgerForOrder.length, "Ledger-entry count unchanged by replay");

  const pos2 = (state2.positions || []).find((p) => p.symbol === "RELIANCE");
  assertDefined(pos2, "Position RELIANCE post replay");
  assert.equal(pos2.quantity, 10, "Position quantity unchanged by replay");
  assert.equal(state2.account?.cashBalance, state1.account?.cashBalance, "Cash balance unchanged by replay");

  // Distinct idempotency key
  const distinctClientOrderId = crypto.randomUUID();
  const distinctIdempotencyKey = `idempotency-${runId}-mkt-2`;
  const distinctPayload = {
    ...marketOrderPayload,
    clientOrderId: distinctClientOrderId,
    idempotencyKey: distinctIdempotencyKey,
  };
  const distinctRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(distinctPayload),
  });
  assertHttpStatus(distinctRes, 200, "Distinct order POST");
  const distinctData = await readJsonOrThrow<OrderPostApiResponse>(distinctRes, "Distinct order POST");

  assertDefined(distinctData.order?.id, "Distinct order ID");
  assert.notEqual(distinctData.order.id, orderData1.order!.id, "Distinct order ID differs from original");
  assert.equal(Boolean(distinctData.idempotentReplay), false, "idempotentReplay is false for new key");
  console.log(`[PASS] Idempotency assertions verified.\n`);

  // --- SECTION 8: LIMIT ORDER AND CANCELLATION ---
  console.log("--- SECTION 8: LIMIT ORDER AND CANCELLATION ASSERTIONS ---");
  const limitClientOrderId = crypto.randomUUID();
  const limitIdempotencyKey = `idempotency-${runId}-lmt-1`;
  const limitPayload = {
    type: "LIMIT",
    clientOrderId: limitClientOrderId,
    idempotencyKey: limitIdempotencyKey,
    symbol: "RELIANCE",
    exchange: "NSE",
    side: "BUY",
    quantity: 5,
    limitPrice: 10.0,
  };

  const limitRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(limitPayload),
  });
  assertHttpStatus(limitRes, 200, "LIMIT order POST");
  const limitData = await readJsonOrThrow<OrderPostApiResponse>(limitRes, "LIMIT order POST");

  assertDefined(limitData.order?.id, "LIMIT order ID");
  assert.equal(limitData.order.status, "PENDING", "LIMIT order status PENDING");
  assert.equal(limitData.fill ?? null, null, "No fill returned for pending LIMIT order");

  console.log(`Cancelling LIMIT order ${limitData.order.id}...`);
  const cancelRes = await fetch(`${RENDER_BASE_URL}/api/paper/orders/${limitData.order.id}`, {
    method: "DELETE",
    headers: headersA,
  });
  assertHttpStatus(cancelRes, 200, "Cancel order DELETE");
  const cancelData = await readJsonOrThrow<OrderDeleteApiResponse>(cancelRes, "Cancel order DELETE");

  assertDefined(cancelData.order?.id, "Cancelled order ID");
  assert.equal(cancelData.order.id, limitData.order.id, "Returned order ID matches cancelled order ID");
  assert.equal(cancelData.order.status, "CANCELLED", "Order status is CANCELLED");
  assertDefined(cancelData.order.cancelledAt, "cancelledAt timestamp");
  assert.equal(Number.isNaN(Date.parse(cancelData.order.cancelledAt)), false, "cancelledAt timestamp is valid");

  const stateRes3 = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  const state3 = await readJsonOrThrow<AccountApiResponse>(stateRes3, "State query post cancellation");

  const cancelledOrderFills = (state3.fills || []).filter((f) => f.orderId === limitData.order!.id);
  assert.equal(cancelledOrderFills.length, 0, "Cancelled order remains unfilled");
  console.log(`[PASS] Limit order and cancellation assertions verified.\n`);

  // --- SECTION 9: RECONCILIATION ASSERTIONS ---
  console.log("--- SECTION 9: LEDGER RECONCILIATION ASSERTIONS ---");
  const finalStateRes = await fetch(`${RENDER_BASE_URL}/api/paper/account`, { headers: headersA });
  assertHttpStatus(finalStateRes, 200, "Final state fetch");
  const finalState = await readJsonOrThrow<AccountApiResponse>(finalStateRes, "Final state fetch");

  assertDefined(finalState.account, "Final account");
  const currentGen = finalState.account.generation;
  const genOrders = (finalState.orders || []).filter((o) => o.generation === currentGen);
  const genFills = (finalState.fills || []).filter((f) => f.generation === currentGen);
  const genLedger = (finalState.ledger || []).filter((l) => l.generation === currentGen);
  const genPositions = (finalState.positions || []).filter((p) => p.generation === currentGen);

  // 1. Order fill quantity assertion
  for (const order of genOrders) {
    const orderFills = genFills.filter((f) => f.orderId === order.id);
    const sumFilledQty = orderFills.reduce((sum, f) => sum + f.qty, 0);
    if (order.status === "FILLED") {
      assert.equal(sumFilledQty, order.qty || order.quantity, `Filled quantity matches order qty for ${order.id}`);
    } else if (order.status === "CANCELLED" || order.status === "PENDING") {
      assert.equal(sumFilledQty < (order.qty || order.quantity!), true, `Unfilled/partially filled qty for ${order.id}`);
    }
  }

  // 2. Cash balance reconciliation
  const initialCashCents = Math.round(1000000 * 100);
  const ledgerCashSumCents = genLedger.reduce((sum, l) => sum + Math.round(l.amount * 100), 0);
  const expectedCashCents = initialCashCents + ledgerCashSumCents;
  const actualCashCents = Math.round(finalState.account.cashBalance * 100);
  assert.equal(actualCashCents, expectedCashCents, `Account cash balance matches initial cash + sum of ledger entries`);

  // 3. Position quantity reconciliation
  const posMap = new Map<string, number>();
  for (const fill of genFills) {
    const fillOrder = genOrders.find((o) => o.id === fill.orderId);
    if (!fillOrder) continue;
    const sign = fillOrder.side === "BUY" ? 1 : -1;
    const current = posMap.get(fillOrder.symbol) || 0;
    posMap.set(fillOrder.symbol, current + sign * fill.qty);
  }

  for (const [symbol, expectedQty] of posMap.entries()) {
    const pos = genPositions.find((p) => p.symbol === symbol);
    if (expectedQty === 0) {
      assert.equal(pos === undefined || pos.quantity === 0, true, `Position for ${symbol} is 0`);
    } else {
      assertDefined(pos, `Position object for ${symbol}`);
      assert.equal(pos.quantity, expectedQty, `Position quantity for ${symbol} matches fills replay`);
    }
  }

  // 4. Fill fees correspond to fee ledger entries
  const feeLedgerCount = genLedger.filter((l) => l.type === "FEE").length;
  assert.equal(feeLedgerCount >= genFills.length, true, "Fee ledger entries correspond to fills");

  // Redacted summary printed ONLY after all assertions pass
  console.log("=== REDACTED RECONCILIATION SUMMARY ===");
  console.log(`Generation: ${currentGen}`);
  console.log(`Orders count: ${genOrders.length}`);
  console.log(`Fills count: ${genFills.length}`);
  console.log(`Ledger entries count: ${genLedger.length}`);
  console.log(`Positions count: ${genPositions.length}`);
  console.log(`Reconciled Cash: ₹${finalState.account.cashBalance.toFixed(2)}`);
  console.log("=======================================\n");

  // --- SECTION 10: AUTHENTICATED SSE ---
  console.log("--- SECTION 10: AUTHENTICATED SSE & CROSS-USER ISOLATION ASSERTIONS ---");
  const unauthSseRes = await fetch(`${RENDER_BASE_URL}/api/paper/stream`);
  assertHttpStatus(unauthSseRes, 401, "Unauthenticated SSE GET");

  // Helper to collect SSE frames over a stream
  async function connectSseStream(
    token: string
  ): Promise<{
    frames: Array<{ event?: string; data?: string; raw: string }>;
    abort: () => void;
    closed: Promise<void>;
  }> {
    const controller = new AbortController();
    const res = await fetch(`${RENDER_BASE_URL}/api/paper/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    assertHttpStatus(res, 200, "Authenticated SSE GET");
    assertDefined(res.body, "SSE response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const frames: Array<{ event?: string; data?: string; raw: string }> = [];

    const closed = (async () => {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const chunk of parts) {
            if (!chunk.trim()) continue;
            let data: string | undefined;
            let event: string | undefined;
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) data = line.slice(6);
              if (line.startsWith("event: ")) event = line.slice(7);
            }
            frames.push({ event, data, raw: chunk });
          }
        }
      } catch {
        // Stream aborted/closed
      } finally {
        reader.releaseLock();
      }
    })();

    return {
      frames,
      abort: () => controller.abort(),
      closed,
    };
  }

  // Connect User A and User B stream concurrently
  const sseA = await connectSseStream(userA.token);
  const sseB = await connectSseStream(userB.token);

  // Require connected frame or heartbeat on User A
  await assertEventually(
    async () => sseA.frames,
    (frames) => frames.some((f) => f.raw.includes("CONNECTED") || f.raw.includes("heartbeat")),
    10000,
    "User A SSE initial frame/heartbeat"
  );
  console.log("[PASS] User A stream received initial frame / heartbeat.");

  // Mutate User A (submit order)
  const sseOrderPayload = {
    type: "MARKET",
    clientOrderId: crypto.randomUUID(),
    idempotencyKey: `idempotency-sse-${runId}`,
    symbol: "INFY",
    exchange: "NSE",
    side: "BUY",
    quantity: 2,
  };

  await fetch(`${RENDER_BASE_URL}/api/paper/orders`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(sseOrderPayload),
  });

  // User A should receive event frame for order/fill mutation
  const userAEventFrame = await assertEventually(
    async () => sseA.frames,
    (frames) => frames.some((f) => f.data && f.data.includes("INFY")),
    10000,
    "User A mutation event frame"
  );

  const matchedFrame = userAEventFrame.find((f) => f.data && f.data.includes("INFY"));
  assertDefined(matchedFrame?.data, "User A mutation frame data");
  const parsedUserAEvent = JSON.parse(matchedFrame.data) as Record<string, unknown>;
  assertDefined(parsedUserAEvent, "Parsed User A event");
  // Assert event data does not contain another user's ID
  assert.equal(
    parsedUserAEvent.userId ? parsedUserAEvent.userId === userA.userId : true,
    true,
    "Event user data does not identify another user"
  );

  // User B isolation check: User B must NOT receive User A's mutation event
  await new Promise((r) => setTimeout(r, 2000));
  const userBInfyFrame = sseB.frames.find((f) => f.data && f.data.includes("INFY"));
  assert.equal(userBInfyFrame, undefined, "User B isolated from User A mutation event");
  console.log("[PASS] Cross-user SSE isolation verified.");

  // Clean up streams
  sseA.abort();
  sseB.abort();
  await Promise.all([sseA.closed, sseB.closed]);
  console.log("[PASS] SSE connections closed cleanly.\n");

  console.log("=================================================");
  console.log("E2E PRODUCTION CERTIFICATION PASSED SUCCESSFULLY");
  console.log("=================================================");
}

runE2ECertification().catch((err) => {
  console.error("Certification failed:", err);
  process.exit(1);
});
