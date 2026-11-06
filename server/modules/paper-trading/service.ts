import { loadExecutionQuote } from "./execution-quote";
import { computePhase, type MarketPhase } from "../../domain/market/clock";
import { withSerializablePaperTransaction } from "./transaction-retry";
import { bus } from "../../infra/bus";
import { getConfig } from "../../config";
import {
  PaperValidationError,
  PaperAccountLockedError,
  PaperOrderNotFoundError,
  PaperOrderConflictError,
  PaperIdempotencyConflictError,
} from "./errors";
import {
  buildOrderAcceptedEvent,
  buildOrderCancelledEvent,
  buildAccountUpdatedEvent,
  buildAccountResetEvent,
} from "./outbox";
import { computeQuoteFingerprint } from "./quote-fingerprint";
import type {
  PaperAccountRow,
  PaperOrderRow,
  PaperPositionRow,
  PaperFillRow,
  PaperOrderCommand,
  PaperTradingState,
} from "./contracts";
import type { PaperDatabase, PaperTradingReadRepository, PaperTradingWriteRepository } from "./repository";
import { createPostgresPaperReadRepository } from "./postgres-repository";
import { applyFill, paperExecutionPolicy, type AppliedFill } from "./fill-writer";
import { ExchangeSchema, parseExecutionQuote, evaluateExecutionQuote } from "@shared/types/market";
import { PaperExecutionError } from "@shared/domain/paper-trading/execution";

export interface PaperTradingServiceDependencies {
  database?: PaperDatabase;
  /** Quote for the order's exchange and symbol (default: live tick feed, then the market-data layer). */
  quoteLoader?: (exchange: "NSE" | "BSE", symbol: string) => Promise<unknown>;
  /** Session phase at a given instant; MARKET orders only execute while it is OPEN. */
  marketPhase?: (now: Date) => MarketPhase;
  now?: () => Date;
  createId?: () => string;
}

export interface PlaceOrderResult {
  order: PaperOrderRow;
  fill: PaperFillRow | null;
  account: PaperAccountRow;
  position: PaperPositionRow | null;
  idempotentReplay: boolean;
  asOf: Date;
}

const CANCELLABLE_ORDER_STATUSES: Partial<Record<PaperOrderRow["status"], true>> = {
  PENDING: true,
  TRIGGER_PENDING: true,
  TRIGGERED: true,
  PARTIALLY_FILLED: true,
};

/** The persisted terms of an order; an idempotency key may only be replayed with identical terms. */
interface OrderTerms {
  symbol: string;
  exchange: "NSE" | "BSE";
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
  qty: number;
  limitPrice: string | null;
  stopPrice: string | null;
  stopLossPrice: string | null;
  takeProfitPrice: string | null;
}

/** Prices are stored as numeric(18,4); normalise requests the same way so replays compare equal. */
function toPrice(value: number | undefined): string | null {
  return value === undefined ? null : value.toFixed(4);
}

function samePrice(stored: string | null, requested: string | null): boolean {
  return stored === null || requested === null ? stored === requested : Number(stored) === Number(requested);
}

function hasSameTerms(order: PaperOrderRow, terms: OrderTerms): boolean {
  return (
    order.symbol === terms.symbol &&
    order.exchange === terms.exchange &&
    order.side === terms.side &&
    order.type === terms.type &&
    order.qty === terms.qty &&
    samePrice(order.limitPrice, terms.limitPrice) &&
    samePrice(order.stopPrice, terms.stopPrice) &&
    samePrice(order.stopLossPrice, terms.stopLossPrice) &&
    samePrice(order.takeProfitPrice, terms.takeProfitPrice)
  );
}

function parseOrderTerms(command: PaperOrderCommand): OrderTerms {
  if (!command || !command.symbol || !command.side || !command.type || !command.qty) {
    throw new PaperValidationError("Invalid order command parameters");
  }
  if (!["BUY", "SELL"].includes(command.side)) {
    throw new PaperValidationError(`Invalid order side: ${command.side}`);
  }
  if (!["MARKET", "LIMIT", "STOP_LOSS_LIMIT"].includes(command.type)) {
    throw new PaperValidationError(`Invalid order type: ${command.type}`);
  }
  if (command.qty <= 0 || !Number.isInteger(command.qty)) {
    throw new PaperValidationError("Order quantity must be a positive integer");
  }
  const exchange = ExchangeSchema.safeParse((command.exchange || "NSE").trim().toUpperCase());
  if (!exchange.success) {
    throw new PaperValidationError(`Invalid exchange: ${command.exchange}`);
  }
  if (command.type !== "MARKET" && (!command.limitPrice || command.limitPrice <= 0)) {
    throw new PaperValidationError(`${command.type} order requires a positive limitPrice`);
  }

  const isStopLimit = command.type === "STOP_LOSS_LIMIT";
  const stopPrice = command.stopPrice ?? command.stopLossPrice;
  if (isStopLimit && (!stopPrice || stopPrice <= 0)) {
    throw new PaperValidationError("STOP_LOSS_LIMIT order requires a positive stopPrice");
  }

  return {
    symbol: command.symbol.trim().toUpperCase(),
    exchange: exchange.data,
    side: command.side,
    type: command.type,
    qty: command.qty,
    limitPrice: command.type === "MARKET" ? null : toPrice(command.limitPrice),
    stopPrice: isStopLimit ? toPrice(stopPrice) : null,
    // A stop-limit is itself an exit; only MARKET and LIMIT entries carry bracket exits.
    stopLossPrice: isStopLimit ? null : toPrice(command.stopLossPrice),
    takeProfitPrice: isStopLimit ? null : toPrice(command.takeProfitPrice),
  };
}

export class PaperTradingService {
  private readonly quoteLoader: (exchange: "NSE" | "BSE", symbol: string) => Promise<unknown>;
  private readonly marketPhase: (now: Date) => MarketPhase;
  private readonly readRepo: PaperTradingReadRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(deps: PaperTradingServiceDependencies = {}) {
    this.quoteLoader = deps.quoteLoader || loadExecutionQuote;
    this.marketPhase = deps.marketPhase || ((now) => computePhase(now, getConfig().nseHolidays));
    this.now = deps.now || (() => new Date());
    this.createId = deps.createId || (() => crypto.randomUUID());
    this.readRepo = createPostgresPaperReadRepository(deps.database);
  }

  async getState(params: { userId: string }): Promise<PaperTradingState> {
    if (!params.userId) {
      throw new PaperValidationError("userId is required");
    }
    return this.readRepo.getState({ userId: params.userId, initialCash: getConfig().paperInitialCashInr });
  }

  async placeOrder(params: {
    userId: string;
    command: PaperOrderCommand;
  }): Promise<PlaceOrderResult> {
    const { userId, command } = params;
    if (!userId) {
      throw new PaperValidationError("userId is required");
    }
    const terms = parseOrderTerms(command);
    const keys = {
      idempotencyKey: command.idempotencyKey || null,
      clientOrderId: command.clientOrderId || null,
    };

    const result =
      terms.type === "MARKET"
        ? await this.placeMarketOrder(userId, terms, keys)
        : await this.placeRestingOrder(userId, terms, keys);
    // After commit: the live feed must subscribe a resting order's symbol before ticks can fill it.
    bus.emit("paper:interest_changed", { reason: "order_placed" });
    return result;
  }

  /**
   * Returns the original result when the idempotency key was already used with the same
   * terms, and rejects the request when the key was used for a different order.
   */
  private async findReplay(
    write: PaperTradingWriteRepository,
    account: PaperAccountRow,
    idempotencyKey: string,
    terms: OrderTerms
  ): Promise<PlaceOrderResult | null> {
    const existing = await write.findOrderByIdempotencyKeyForUpdate({
      userId: account.userId,
      generation: account.generation,
      idempotencyKey,
    });
    if (!existing) {
      return null;
    }
    if (!hasSameTerms(existing, terms)) {
      throw new PaperIdempotencyConflictError(
        `Idempotency key ${idempotencyKey} was already used for a different order`
      );
    }
    const fill = await write.findLatestFillForOrder(existing.id);
    const position = await write.findPositionForUpdate({
      userId: account.userId,
      generation: account.generation,
      symbol: existing.symbol,
      exchange: existing.exchange,
    });
    return {
      order: existing,
      fill: fill ?? null,
      account,
      position: position ?? null,
      idempotentReplay: true,
      asOf: this.now(),
    };
  }

  private async placeMarketOrder(
    userId: string,
    terms: OrderTerms,
    keys: { idempotencyKey: string | null; clientOrderId: string | null }
  ): Promise<PlaceOrderResult> {
    const initialCash = getConfig().paperInitialCashInr;
    const { idempotencyKey } = keys;

    // A retried request must get its original result even once the session or quote is gone.
    if (idempotencyKey) {
      const replay = await withSerializablePaperTransaction(async (repos) => {
        const account = await repos.write.ensureAccountForUpdate({ userId, initialCash });
        return this.findReplay(repos.write, account, idempotencyKey, terms);
      });
      if (replay) {
        return replay;
      }
    }

    const phase = this.marketPhase(this.now());
    if (phase !== "OPEN") {
      throw new PaperValidationError(
        `Market is ${phase}: MARKET orders execute only during the regular session (09:15-15:30 IST)`
      );
    }

    let rawQuote: unknown;
    try {
      rawQuote = await this.quoteLoader(terms.exchange, terms.symbol);
    } catch (err: unknown) {
      throw new PaperValidationError(`Failed to load execution quote for ${terms.symbol}`, undefined, err);
    }

    const parsedQuoteResult = parseExecutionQuote(rawQuote, terms.symbol);
    if (!parsedQuoteResult.ok) {
      throw new PaperValidationError(`Invalid quote for ${terms.symbol}: ${parsedQuoteResult.reason}`);
    }
    const quote = parsedQuoteResult.quote;
    if (quote.exchange !== terms.exchange) {
      throw new PaperValidationError(
        `Quote for ${terms.symbol} is from ${quote.exchange}, but the order routes to ${terms.exchange}`
      );
    }

    const policy = evaluateExecutionQuote(quote, terms.symbol, paperExecutionPolicy());
    if (!policy.executable) {
      throw new PaperValidationError(`Quote for ${terms.symbol} cannot be executed: ${policy.reason}`);
    }

    const fingerprint = computeQuoteFingerprint({
      exchange: quote.exchange,
      symbol: quote.symbol,
      source: quote.source,
      quality: quote.quality,
      ts: quote.ts,
      price: quote.price,
      volume: quote.volume,
    });

    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({ userId, initialCash });
      if (accountRow.status !== "ACTIVE") {
        throw new PaperAccountLockedError(`Account is in ${accountRow.status} state. Orders disabled.`);
      }

      if (idempotencyKey) {
        const replay = await this.findReplay(repos.write, accountRow, idempotencyKey, terms);
        if (replay) {
          return replay;
        }
      }

      const positions = await repos.write.findPositionsForUpdate({
        userId,
        generation: accountRow.generation,
      });

      const now = this.now();
      const order = await repos.write.insertOrder({
        id: this.createId(),
        userId,
        ...keys,
        ...terms,
        generation: accountRow.generation,
        status: "PENDING",
        filledQty: 0,
        quoteSource: quote.source,
        quoteQuality: quote.quality,
        quoteTimestamp: new Date(quote.ts),
        referencePrice: String(quote.price),
        version: 1,
        placedAt: now,
        updatedAt: now,
      });

      let applied: AppliedFill;
      try {
        applied = await applyFill({
          write: repos.write,
          account: accountRow,
          order,
          positions,
          quote,
          quoteFingerprint: fingerprint,
          fillQuantity: terms.qty,
          reason: "USER_ORDER",
          ledgerSourceType: "FILL",
          now,
          createId: this.createId,
        });
      } catch (err: unknown) {
        if (err instanceof PaperExecutionError) {
          throw new PaperValidationError(`Order execution failed: ${err.message}`, undefined, err);
        }
        throw err;
      }

      await repos.write.insertOutboxEvents([
        buildOrderAcceptedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperOrder",
          aggregateId: order.id,
          payload: { orderId: order.id },
        }),
      ]);

      return {
        order: applied.order,
        fill: applied.fill,
        account: applied.account,
        position: applied.position,
        idempotentReplay: false,
        asOf: this.now(),
      };
    });
  }

  private async placeRestingOrder(
    userId: string,
    terms: OrderTerms,
    keys: { idempotencyKey: string | null; clientOrderId: string | null }
  ): Promise<PlaceOrderResult> {
    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({
        userId,
        initialCash: getConfig().paperInitialCashInr,
      });

      if (accountRow.status !== "ACTIVE") {
        throw new PaperAccountLockedError(`Account is in ${accountRow.status} state. Orders disabled.`);
      }

      if (keys.idempotencyKey) {
        const replay = await this.findReplay(repos.write, accountRow, keys.idempotencyKey, terms);
        if (replay) {
          return replay;
        }
      }

      const orderId = this.createId();
      const initialStatus = terms.type === "STOP_LOSS_LIMIT" ? "TRIGGER_PENDING" : "PENDING";

      const orderRow = await repos.write.insertOrder({
        id: orderId,
        userId,
        ...keys,
        ...terms,
        generation: accountRow.generation,
        status: initialStatus,
        filledQty: 0,
        version: 1,
        placedAt: this.now(),
        updatedAt: this.now(),
      });

      const newAccountVersion = Number(accountRow.version) + 1;
      const updatedAccountRow = await repos.write.updateAccount(userId, {
        version: newAccountVersion,
        updatedAt: this.now(),
      });

      await repos.write.insertOutboxEvents([
        buildOrderAcceptedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperOrder",
          aggregateId: orderId,
          payload: { orderId, status: initialStatus },
        }),
        buildAccountUpdatedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { version: newAccountVersion },
        }),
      ]);

      return {
        order: orderRow,
        fill: null,
        account: updatedAccountRow,
        position: null,
        idempotentReplay: false,
        asOf: this.now(),
      };
    });
  }

  /** Cancels a working order; any quantity already filled stays filled. */
  async cancelOrder(params: { userId: string; orderId: string }): Promise<PaperOrderRow> {
    const { userId, orderId } = params;
    if (!userId || !orderId) {
      throw new PaperValidationError("userId and orderId are required");
    }

    const cancelled = await withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({
        userId,
        initialCash: getConfig().paperInitialCashInr,
      });
      const orderRow = await repos.write.findOrderForUpdate({ userId, orderId });

      if (!orderRow) {
        throw new PaperOrderNotFoundError(`Order ${orderId} not found`);
      }

      if (!CANCELLABLE_ORDER_STATUSES[orderRow.status]) {
        throw new PaperOrderConflictError(`Cannot cancel order in ${orderRow.status} state`);
      }

      const cancelledOrder = await repos.write.updateOrder(orderId, {
        status: "CANCELLED",
        cancelledAt: this.now(),
        updatedAt: this.now(),
      });

      const newAccountVersion = Number(accountRow.version) + 1;
      await repos.write.updateAccount(userId, {
        version: newAccountVersion,
        updatedAt: this.now(),
      });

      await repos.write.insertOutboxEvents([
        buildOrderCancelledEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperOrder",
          aggregateId: orderId,
          payload: { orderId, cancelledAt: this.now().toISOString(), filledQty: cancelledOrder.filledQty },
        }),
        buildAccountUpdatedEvent({
          userId,
          generation: accountRow.generation,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { version: newAccountVersion },
        }),
      ]);

      return cancelledOrder;
    });
    bus.emit("paper:interest_changed", { reason: "order_cancelled" });
    return cancelled;
  }

  async resetAccount(params: {
    userId: string;
    confirmation?: boolean;
  }): Promise<PaperAccountRow> {
    const { userId, confirmation } = params;
    if (!userId) {
      throw new PaperValidationError("userId is required");
    }
    if (!confirmation) {
      throw new PaperValidationError("Account reset requires explicit confirmation");
    }

    const initialCash = getConfig().paperInitialCashInr;
    const reset = await withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({ userId, initialCash });

      await repos.write.cancelOpenOrders({
        userId,
        generation: accountRow.generation,
        reason: "Account reset requested",
      });

      const nextGen = accountRow.generation + 1;
      const initialCashStr = initialCash.toFixed(4);

      const resetAccountRow = await repos.write.updateAccount(userId, {
        cashBalance: initialCashStr,
        initialCash: initialCashStr,
        realisedPnl: "0.0000",
        allocatedMargin: "0.0000",
        maintenanceMargin: "0.0000",
        status: "ACTIVE",
        isLocked: false,
        lockReason: null,
        lockedAt: null,
        liquidationCompletedAt: null,
        generation: nextGen,
        version: Number(accountRow.version) + 1,
        resetAt: this.now(),
        updatedAt: this.now(),
      });

      await repos.write.insertLedgerEntries([
        {
          id: this.createId(),
          userId,
          generation: nextGen,
          fillId: null,
          entryType: "INITIAL_CASH",
          amount: initialCashStr,
          balanceAfter: initialCashStr,
          currency: "INR",
          sourceType: "RESET",
          sourceId: `reset:${nextGen}`,
          metadata: { generation: nextGen },
          createdAt: this.now(),
        },
      ]);

      await repos.write.insertOutboxEvents([
        buildAccountResetEvent({
          userId,
          generation: nextGen,
          aggregateType: "PaperAccount",
          aggregateId: userId,
          payload: { generation: nextGen, resetAt: this.now().toISOString() },
        }),
      ]);

      return resetAccountRow;
    });
    bus.emit("paper:interest_changed", { reason: "account_reset" });
    return reset;
  }

  async listOrders(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }) {
    return this.readRepo.listOrders(params);
  }

  async listFills(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }) {
    return this.readRepo.listFills(params);
  }

  async listLedger(params: {
    userId: string;
    generation?: number;
    limit?: number;
    cursor?: string;
  }) {
    return this.readRepo.listLedger(params);
  }
}

export function createPaperTradingService(
  deps: PaperTradingServiceDependencies = {}
): PaperTradingService {
  return new PaperTradingService(deps);
}
