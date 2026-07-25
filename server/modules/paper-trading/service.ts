import { loadQuote } from "../../domain/market/quote-service";
import { withSerializablePaperTransaction } from "./transaction-retry";
import {
  PaperValidationError,
  PaperAccountLockedError,
  PaperOrderNotFoundError,
  PaperOrderConflictError,
} from "./errors";
import {
  buildOrderAcceptedEvent,
  buildOrderCancelledEvent,
  buildOrderFilledEvent,
  buildPositionUpdatedEvent,
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
import type { PaperDatabase, PaperTradingReadRepository } from "./repository";
import { createPostgresPaperReadRepository } from "./postgres-repository";
import { parseExecutionQuote, evaluateExecutionQuote } from "@shared/types/market";
import { executePaperFill } from "@shared/domain/paper-trading/execution";
import type { PaperAccount, PaperOrder, PaperExecutionReason } from "@shared/domain/paper-trading/types";

export const PAPER_INITIAL_CASH_INR = Number(process.env.PAPER_INITIAL_CASH_INR || 1000000);

export interface PaperTradingServiceDependencies {
  database?: PaperDatabase;
  quoteLoader?: (symbol: string, force?: boolean) => Promise<unknown>;
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

export class PaperTradingService {
  private readonly quoteLoader: (symbol: string, force?: boolean) => Promise<unknown>;
  private readonly readRepo: PaperTradingReadRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(deps: PaperTradingServiceDependencies = {}) {
    this.quoteLoader = deps.quoteLoader || loadQuote;
    this.now = deps.now || (() => new Date());
    this.createId = deps.createId || (() => crypto.randomUUID());
    this.readRepo = createPostgresPaperReadRepository(deps.database as any);
  }

  async getState(params: { userId: string }): Promise<PaperTradingState> {
    if (!params.userId) {
      throw new PaperValidationError("userId is required");
    }
    return this.readRepo.getState({ userId: params.userId });
  }

  async placeOrder(params: {
    userId: string;
    command: PaperOrderCommand;
  }): Promise<PlaceOrderResult> {
    const { userId, command } = params;

    if (!userId) {
      throw new PaperValidationError("userId is required");
    }
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

    const symbol = command.symbol.trim().toUpperCase();
    const exchange = (command.exchange || "NSE").trim().toUpperCase();
    const idempotencyKey = command.idempotencyKey || null;
    const clientOrderId = command.clientOrderId || null;

    if (command.type === "MARKET") {
      let rawQuote: unknown;
      try {
        rawQuote = await this.quoteLoader(symbol, true);
      } catch (err: unknown) {
        throw new PaperValidationError(`Failed to load execution quote for ${symbol}`, undefined, err);
      }

      const parsedQuoteResult = parseExecutionQuote(rawQuote, symbol);
      if (!parsedQuoteResult.ok) {
        throw new PaperValidationError(`Invalid quote for ${symbol}: ${parsedQuoteResult.reason}`);
      }
      const quote = parsedQuoteResult.quote;

      const policy = evaluateExecutionQuote(quote, symbol);
      if (!policy.executable) {
        throw new PaperValidationError(`Quote for ${symbol} cannot be executed: ${policy.reason}`);
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
        const accountRow = await repos.write.ensureAccountForUpdate({
          userId,
          initialCash: PAPER_INITIAL_CASH_INR,
        });

        if (accountRow.status !== "ACTIVE") {
          throw new PaperAccountLockedError(`Account is in ${accountRow.status} state. Orders disabled.`);
        }

        if (idempotencyKey) {
          const existingOrder = await repos.write.findOrderByIdempotencyKeyForUpdate({
            userId,
            idempotencyKey,
          });
          if (existingOrder) {
            return {
              order: existingOrder,
              fill: null,
              account: accountRow,
              position: null,
              idempotentReplay: true,
              asOf: this.now(),
            };
          }
        }

        const currentPositions = await repos.write.findPositionsForUpdate({
          userId,
          generation: accountRow.generation,
        });

        const orderId = this.createId();
        const orderRowInput = {
          id: orderId,
          userId,
          clientOrderId,
          idempotencyKey,
          generation: accountRow.generation,
          symbol,
          exchange,
          side: command.side,
          type: command.type,
          status: "PENDING" as const,
          qty: command.qty,
          filledQty: 0,
          quoteSource: quote.source,
          quoteQuality: quote.quality,
          quoteTimestamp: new Date(quote.ts),
          referencePrice: String(quote.price),
          lastQuoteFingerprint: fingerprint,
          version: 1,
          placedAt: this.now(),
          updatedAt: this.now(),
        };

        const initialOrderRow = await repos.write.insertOrder(orderRowInput);

        const domainAccount: PaperAccount = {
          version: 3,
          initialCash: Number(accountRow.initialCash),
          cash: Number(accountRow.cashBalance),
          allocatedMargin: Number(accountRow.allocatedMargin),
          maintenanceMargin: Number(accountRow.maintenanceMargin),
          realisedPnl: Number(accountRow.realisedPnl),
          status: accountRow.status as any,
          positions: currentPositions.map((p) => ({
            symbol: p.symbol,
            quantity: p.totalShares,
            averagePrice: Number(p.averageEntryPrice),
            marginLocked: Number(p.marginLocked),
            realisedPnl: Number(p.realizedPnl),
            unrealisedPnl: Number(p.unrealizedPnl || 0),
            updatedAt: p.updatedAt.toISOString(),
          })),
          orders: [],
          fills: [],
        };

        const domainOrder: PaperOrder = {
          id: orderId,
          symbol,
          side: command.side,
          type: command.type,
          status: "PENDING",
          quantity: command.qty,
          filledQuantity: 0,
          createdAt: initialOrderRow.placedAt.toISOString(),
          updatedAt: initialOrderRow.updatedAt.toISOString(),
        };

        const reason: PaperExecutionReason = "USER_ORDER";

        let fillResult: ReturnType<typeof executePaperFill>;
        try {
          fillResult = executePaperFill({
            account: domainAccount,
            order: domainOrder,
            fillQuantity: command.qty,
            quote,
            reason,
          });
        } catch (err: unknown) {
          throw new PaperValidationError(`Order execution failed: ${err instanceof Error ? err.message : String(err)}`, undefined, err);
        }

        const fillRowId = this.createId();
        const updatedOrderRow = await repos.write.updateOrder(orderId, {
          status: "FILLED",
          filledQty: command.qty,
          lastFillAt: this.now(),
        });

        const fillRow = await repos.write.insertFill({
          id: fillRowId,
          orderId,
          userId,
          generation: accountRow.generation,
          symbol,
          exchange,
          side: command.side,
          quantity: command.qty,
          referencePrice: String(fillResult.fill.referencePrice),
          fillPrice: String(fillResult.fill.fillPrice),
          slippage: String(fillResult.fill.slippage),
          fees: String(fillResult.fill.fees),
          realizedPnl: String(fillResult.fill.realisedPnl),
          quoteSource: quote.source,
          quoteQuality: quote.quality,
          quoteTimestamp: new Date(quote.ts),
          quoteFingerprint: fingerprint,
          executionReason: fillResult.fill.reason,
          executionSequence: 1,
          executedAt: this.now(),
        });

        const existingPos = currentPositions.find(
          (p) => p.symbol === symbol && p.exchange === exchange
        );

        let finalPositionRow: PaperPositionRow | null = null;
        const updatedDomainPos = fillResult.account.positions.find(
          (p) => p.symbol === symbol
        );

        if (existingPos) {
          if (updatedDomainPos && updatedDomainPos.quantity !== 0) {
            finalPositionRow = await repos.write.upsertPosition({
              id: existingPos.id,
              userId,
              generation: accountRow.generation,
              symbol,
              exchange,
              averageEntryPrice: String(updatedDomainPos.averagePrice),
              totalShares: Math.abs(updatedDomainPos.quantity),
              realizedPnl: String(updatedDomainPos.realisedPnl),
              unrealizedPnl: String(updatedDomainPos.unrealisedPnl),
              marginLocked: String(updatedDomainPos.marginLocked),
              version: existingPos.version + 1,
              updatedAt: this.now(),
            });
          } else {
            await repos.write.deletePosition({
              userId,
              generation: accountRow.generation,
              symbol,
              exchange,
            });
          }
        } else if (updatedDomainPos && updatedDomainPos.quantity !== 0) {
          finalPositionRow = await repos.write.upsertPosition({
            id: this.createId(),
            userId,
            generation: accountRow.generation,
            symbol,
            exchange,
            averageEntryPrice: String(updatedDomainPos.averagePrice),
            totalShares: Math.abs(updatedDomainPos.quantity),
            realizedPnl: String(updatedDomainPos.realisedPnl),
            unrealizedPnl: String(updatedDomainPos.unrealisedPnl),
            marginLocked: String(updatedDomainPos.marginLocked),
            version: 1,
            createdAt: this.now(),
            updatedAt: this.now(),
          });
        }

        const newAccountVersion = Number(accountRow.version) + 1;
        const updatedAccountRow = await repos.write.updateAccount(userId, {
          cashBalance: String(fillResult.account.cash),
          realisedPnl: String(fillResult.account.realisedPnl),
          version: newAccountVersion,
          updatedAt: this.now(),
        });

        await repos.write.insertLedgerEntries([
          {
            id: this.createId(),
            userId,
            generation: accountRow.generation,
            fillId: fillRowId,
            entryType: "EXECUTION_FEE",
            amount: String(-fillResult.fill.fees),
            balanceAfter: String(fillResult.account.cash),
            currency: "INR",
            sourceType: "FILL",
            sourceId: fillRowId,
            metadata: { feeRate: 0.0000345 },
            createdAt: this.now(),
          },
        ]);

        await repos.write.insertOutboxEvents([
          buildOrderAcceptedEvent({
            userId,
            generation: accountRow.generation,
            aggregateType: "PaperOrder",
            aggregateId: orderId,
            payload: { orderId },
          }),
          buildOrderFilledEvent({
            userId,
            generation: accountRow.generation,
            aggregateType: "PaperOrder",
            aggregateId: orderId,
            payload: { fillId: fillRowId, fillPrice: fillResult.fill.fillPrice, qty: command.qty },
          }),
          buildPositionUpdatedEvent({
            userId,
            generation: accountRow.generation,
            aggregateType: "PaperPosition",
            aggregateId: `${userId}:${symbol}`,
            payload: { symbol },
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
          order: updatedOrderRow,
          fill: fillRow,
          account: updatedAccountRow,
          position: finalPositionRow,
          idempotentReplay: false,
          asOf: this.now(),
        };
      });
    }

    // LIMIT and STOP_LOSS_LIMIT queued orders
    if (command.type === "LIMIT" && (!command.limitPrice || command.limitPrice <= 0)) {
      throw new PaperValidationError("LIMIT order requires a positive limitPrice");
    }
    if (command.type === "STOP_LOSS_LIMIT" && (!command.stopPrice && !command.stopLossPrice)) {
      throw new PaperValidationError("STOP_LOSS_LIMIT order requires stopPrice or stopLossPrice");
    }

    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({
        userId,
        initialCash: PAPER_INITIAL_CASH_INR,
      });

      if (accountRow.status !== "ACTIVE") {
        throw new PaperAccountLockedError(`Account is in ${accountRow.status} state. Orders disabled.`);
      }

      if (idempotencyKey) {
        const existingOrder = await repos.write.findOrderByIdempotencyKeyForUpdate({
          userId,
          idempotencyKey,
        });
        if (existingOrder) {
          return {
            order: existingOrder,
            fill: null,
            account: accountRow,
            position: null,
            idempotentReplay: true,
            asOf: this.now(),
          };
        }
      }

      const orderId = this.createId();
      const initialStatus = command.type === "STOP_LOSS_LIMIT" ? "TRIGGER_PENDING" : "PENDING";

      const orderRow = await repos.write.insertOrder({
        id: orderId,
        userId,
        clientOrderId,
        idempotencyKey,
        generation: accountRow.generation,
        symbol,
        exchange,
        side: command.side,
        type: command.type,
        status: initialStatus,
        qty: command.qty,
        filledQty: 0,
        limitPrice: command.limitPrice ? String(command.limitPrice) : null,
        stopPrice: command.stopPrice ? String(command.stopPrice) : command.stopLossPrice ? String(command.stopLossPrice) : null,
        stopLossPrice: command.stopLossPrice ? String(command.stopLossPrice) : null,
        takeProfitPrice: command.takeProfitPrice ? String(command.takeProfitPrice) : null,
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

  async cancelOrder(params: { userId: string; orderId: string }): Promise<PaperOrderRow> {
    const { userId, orderId } = params;
    if (!userId || !orderId) {
      throw new PaperValidationError("userId and orderId are required");
    }

    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({ userId });
      const orderRow = await repos.write.findOrderForUpdate({ userId, orderId });

      if (!orderRow) {
        throw new PaperOrderNotFoundError(`Order ${orderId} not found`);
      }

      if (!["PENDING", "TRIGGER_PENDING"].includes(orderRow.status)) {
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
          payload: { orderId, cancelledAt: this.now().toISOString() },
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

    return withSerializablePaperTransaction(async (repos) => {
      const accountRow = await repos.write.ensureAccountForUpdate({
        userId,
        initialCash: PAPER_INITIAL_CASH_INR,
      });

      await repos.write.cancelOpenOrders({
        userId,
        generation: accountRow.generation,
        reason: "Account reset requested",
      });

      const nextGen = accountRow.generation + 1;
      const initialCashStr = String(PAPER_INITIAL_CASH_INR);

      const resetAccountRow = await repos.write.updateAccount(userId, {
        cashBalance: initialCashStr,
        initialCash: initialCashStr,
        realisedPnl: "0.0000",
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
