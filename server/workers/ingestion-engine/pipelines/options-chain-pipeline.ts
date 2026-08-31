import { randomUUID } from "node:crypto";
import {
  getAngelOneFullMarketQuotes,
  getAngelOneOptionGreeks,
  hasAngelOneMarketSession,
  resolveAngelOneOptionContracts,
  type AngelOneFullMarketQuote,
  type AngelOneFullMarketQuoteRequest,
} from "../../../data/sources/angelone/client";
import { getLogger } from "../../../infra/logger";
import {
  appendOptionGreekSnapshots,
  appendOptionQuoteSnapshots,
  getOptionGreekKey,
  hasOptionGreekMarketContent,
  hasOptionQuoteMarketContent,
  indexOptionContractsByGreekKey,
  normalizeAngelOneOptionExpiry,
  syncOptionContracts,
  type CanonicalOptionContract,
  type OptionGreekSnapshotInput,
  type OptionQuoteSnapshotInput,
} from "../../../modules/options/repository";
import { pushToDLQ, type DLQEntry } from "../queue/dead-letter-queue";
import { completeIngestionRun, startIngestionRun } from "../writers/supabase-writer";

const logger = getLogger("pipeline:options-chain");
const QUOTE_BATCH_SIZE = 50;
const QUOTE_REQUEST_INTERVAL_MS = 1_000;

type QuoteRequestStartGate = {
  tail: Promise<void>;
  lastStartedAt?: number;
};

const quoteRequestStartGates = new WeakMap<OptionChainPipelineDependencies, QuoteRequestStartGate>();

export type OptionChainPipelineOptions = {
  underlying: string;
  expiry: string;
};

export type OptionChainPipelineResult = {
  runId: string;
  status: "success" | "partial" | "failed";
  underlying: string;
  expiry: string;
  contractsResolved: number;
  contractsSynced: number;
  quoteBatches: number;
  quotesFetched: number;
  quoteSnapshotsInserted: number;
  quoteSnapshotsDuplicate: number;
  quoteContractsMissing: number;
  greekRowsFetched: number;
  greekContractsMatched: number;
  greekSnapshotsInserted: number;
  greekContractsWithoutProviderGreek: number;
  durationMs: number;
};

export type OptionChainPipelineDependencies = {
  hasMarketSession: typeof hasAngelOneMarketSession;
  resolveContracts: typeof resolveAngelOneOptionContracts;
  syncContracts: typeof syncOptionContracts;
  getFullQuotes: typeof getAngelOneFullMarketQuotes;
  appendQuoteSnapshots: typeof appendOptionQuoteSnapshots;
  getGreeks: typeof getAngelOneOptionGreeks;
  appendGreekSnapshots: typeof appendOptionGreekSnapshots;
  startRun: typeof startIngestionRun;
  completeRun: typeof completeIngestionRun;
  pushToDLQ: (entry: DLQEntry) => Promise<void>;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
};

export class OptionChainIngestionError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "OptionChainIngestionError";
  }
}

const productionDependencies: OptionChainPipelineDependencies = {
  hasMarketSession: hasAngelOneMarketSession,
  resolveContracts: resolveAngelOneOptionContracts,
  syncContracts: syncOptionContracts,
  getFullQuotes: getAngelOneFullMarketQuotes,
  appendQuoteSnapshots: appendOptionQuoteSnapshots,
  getGreeks: getAngelOneOptionGreeks,
  appendGreekSnapshots: appendOptionGreekSnapshots,
  startRun: startIngestionRun,
  completeRun: completeIngestionRun,
  pushToDLQ,
  now: () => new Date(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function compareContracts(left: CanonicalOptionContract, right: CanonicalOptionContract): number {
  const leftStrike = BigInt(left.strikePrice.replace(".", ""));
  const rightStrike = BigInt(right.strikePrice.replace(".", ""));
  if (leftStrike !== rightStrike) return leftStrike < rightStrike ? -1 : 1;
  if (left.optionType !== right.optionType) return left.optionType === "CE" ? -1 : 1;
  const symbolDifference = left.tradingSymbol.localeCompare(right.tradingSymbol);
  return symbolDifference !== 0 ? symbolDifference : left.token.localeCompare(right.token);
}

function partitionContracts(contracts: CanonicalOptionContract[]): CanonicalOptionContract[][] {
  const batches: CanonicalOptionContract[][] = [];
  for (let index = 0; index < contracts.length; index += QUOTE_BATCH_SIZE) {
    batches.push(contracts.slice(index, index + QUOTE_BATCH_SIZE));
  }
  return batches;
}

async function getRateLimitedFullQuotes(
  dependencies: OptionChainPipelineDependencies,
  requests: AngelOneFullMarketQuoteRequest[],
): Promise<AngelOneFullMarketQuote[]> {
  let gate = quoteRequestStartGates.get(dependencies);
  if (!gate) {
    gate = { tail: Promise.resolve() };
    quoteRequestStartGates.set(dependencies, gate);
  }

  const precedingStart = gate.tail;
  let releaseStart!: () => void;
  gate.tail = new Promise<void>((resolve) => { releaseStart = resolve; });
  await precedingStart;

  try {
    if (gate.lastStartedAt !== undefined) {
      let waitMs = gate.lastStartedAt + QUOTE_REQUEST_INTERVAL_MS - dependencies.now().getTime();
      while (waitMs > 0) {
        await dependencies.sleep(waitMs);
        waitMs = gate.lastStartedAt + QUOTE_REQUEST_INTERVAL_MS - dependencies.now().getTime();
      }
    }
    gate.lastStartedAt = dependencies.now().getTime();
    return dependencies.getFullQuotes(requests);
  } finally {
    releaseStart();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quoteIdentity(quote: Pick<AngelOneFullMarketQuote, "exchange" | "token">): string {
  return `${quote.exchange}:${quote.token}`;
}

export async function runOptionChainIngestion(
  options: OptionChainPipelineOptions,
  dependencies: OptionChainPipelineDependencies = productionDependencies,
): Promise<OptionChainPipelineResult> {
  const underlying = options.underlying.trim().toUpperCase();
  if (!underlying) throw new Error("option chain underlying must not be empty");
  const expiry = options.expiry.trim().toUpperCase();
  const expiryDate = normalizeAngelOneOptionExpiry(expiry);
  const startedAt = dependencies.now();
  const runId = `options-${underlying}-${expiry}-${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;

  const result: OptionChainPipelineResult = {
    runId,
    status: "success",
    underlying,
    expiry,
    contractsResolved: 0,
    contractsSynced: 0,
    quoteBatches: 0,
    quotesFetched: 0,
    quoteSnapshotsInserted: 0,
    quoteSnapshotsDuplicate: 0,
    quoteContractsMissing: 0,
    greekRowsFetched: 0,
    greekContractsMatched: 0,
    greekSnapshotsInserted: 0,
    greekContractsWithoutProviderGreek: 0,
    durationMs: 0,
  };
  const quoteFailures = new Set<string>();
  const storedQuoteContracts = new Set<string>();
  const issueCodes = new Set<string>();

  const complete = async (status: OptionChainPipelineResult["status"]): Promise<void> => {
    const symbolsFailed = quoteFailures.size;
    await dependencies.completeRun({
      runId,
      status,
      symbolsAttempted: result.contractsSynced,
      symbolsSucceeded: Math.max(result.contractsSynced - symbolsFailed, 0),
      symbolsFailed,
      recordsInserted: result.quoteSnapshotsInserted + result.greekSnapshotsInserted,
      errorMessage: issueCodes.size > 0 ? [...issueCodes].join(", ") : undefined,
      startedAt,
    });
  };

  const recordFailure = async (
    errorCode: string,
    message: string,
    rawPayload?: Record<string, unknown>,
  ): Promise<void> => {
    issueCodes.add(errorCode);
    try {
      await dependencies.pushToDLQ({
        source: "angelone",
        pipeline: "options-chain",
        batchId: runId,
        symbol: underlying,
        errorCode,
        errorMessage: message,
        rawPayload,
      });
    } catch (dlqError) {
      logger.error({ err: dlqError, runId, errorCode }, "Option-chain DLQ write failed");
    }
  };

  const failRun = async (
    error: Error,
    errorCode: string,
    rawPayload?: Record<string, unknown>,
    record = true,
  ): Promise<never> => {
    if (record) await recordFailure(errorCode, error.message, rawPayload);
    try {
      await complete("failed");
    } catch (completionError) {
      logger.error({ err: completionError, runId }, "Failed to complete failed option-chain run");
    }
    throw error;
  };

  await dependencies.startRun({
    runId,
    source: "angelone",
    pipeline: "options-chain",
    metadata: { provider: "angelone", exchange: "NFO", underlying, expiry },
  });

  if (!dependencies.hasMarketSession()) {
    return failRun(
      new OptionChainIngestionError(
        "OPTION_SESSION_UNAVAILABLE",
        "Angel One market session is not active",
      ),
      "OPTION_SESSION_UNAVAILABLE",
      { expiry },
    );
  }

  let resolvedContracts;
  try {
    resolvedContracts = await dependencies.resolveContracts({ name: underlying, expiry });
  } catch (error) {
    const resolutionError = error instanceof Error ? error : new Error(errorMessage(error));
    return failRun(resolutionError, "OPTION_CONTRACT_RESOLUTION_FAILED", { expiry });
  }
  result.contractsResolved = resolvedContracts.length;
  if (resolvedContracts.length === 0) {
    return failRun(
      new OptionChainIngestionError("OPTION_CONTRACTS_UNAVAILABLE", "no option contracts resolved"),
      "OPTION_CONTRACTS_UNAVAILABLE",
      { expiry },
    );
  }

  let canonicalContracts: CanonicalOptionContract[];
  try {
    canonicalContracts = await dependencies.syncContracts({
      underlying,
      expiryDate,
      contracts: resolvedContracts,
    });
  } catch (error) {
    const persistenceError = error instanceof Error ? error : new Error(errorMessage(error));
    return failRun(persistenceError, "OPTION_CONTRACT_WRITE_FAILED", {
      expiry,
      contractCount: resolvedContracts.length,
    });
  }
  canonicalContracts = [...canonicalContracts].sort(compareContracts);
  result.contractsSynced = canonicalContracts.length;
  if (canonicalContracts.length === 0) {
    return failRun(
      new OptionChainIngestionError(
        "OPTION_CONTRACT_WRITE_FAILED",
        "no canonical option contracts were persisted",
      ),
      "OPTION_CONTRACT_WRITE_FAILED",
      { expiry, contractCount: resolvedContracts.length },
    );
  }

  const quoteBatches = partitionContracts(canonicalContracts);
  result.quoteBatches = quoteBatches.length;

  for (let batchIndex = 0; batchIndex < quoteBatches.length; batchIndex++) {
    const batchContracts = quoteBatches[batchIndex];
    const requests: AngelOneFullMarketQuoteRequest[] = batchContracts.map((contract) => ({
      exchange: "NFO",
      token: contract.token,
      tradingSymbol: contract.tradingSymbol,
    }));
    let quotes: AngelOneFullMarketQuote[];
    try {
      quotes = await getRateLimitedFullQuotes(dependencies, requests);
    } catch (error) {
      for (const contract of batchContracts) quoteFailures.add(contract.id);
      result.quoteContractsMissing += batchContracts.length;
      await recordFailure("OPTION_QUOTE_FETCH_FAILED", errorMessage(error), {
        expiry,
        batchIndex,
        requestCount: batchContracts.length,
        requestedTradingSymbols: batchContracts.map((contract) => contract.tradingSymbol),
        requestedTokens: batchContracts.map((contract) => contract.token),
      });
      continue;
    }

    result.quotesFetched += quotes.length;
    const requestedByIdentity = new Map(
      batchContracts.map((contract) => [`NFO:${contract.token}`, contract]),
    );
    const usableQuoteByContractId = new Map<string, AngelOneFullMarketQuote>();
    for (const quote of quotes) {
      const contract = requestedByIdentity.get(quoteIdentity(quote));
      if (
        contract
        && quote.tradingSymbol.trim().toUpperCase() === contract.tradingSymbol.trim().toUpperCase()
        && hasOptionQuoteMarketContent(quote)
      ) {
        usableQuoteByContractId.set(contract.id, quote);
      }
    }

    const quoteInputs: OptionQuoteSnapshotInput[] = [];
    const missingContracts: CanonicalOptionContract[] = [];
    for (const contract of batchContracts) {
      const quote = usableQuoteByContractId.get(contract.id);
      if (!quote) {
        quoteFailures.add(contract.id);
        result.quoteContractsMissing++;
        missingContracts.push(contract);
        continue;
      }
      quoteInputs.push({ contractId: contract.id, quote });
    }
    if (missingContracts.length > 0) {
      await recordFailure(
        "OPTION_QUOTES_MISSING",
        `${missingContracts.length} requested contracts lacked a verified usable quote`,
        {
          expiry,
          batchIndex,
          missingTradingSymbols: missingContracts.map((contract) => contract.tradingSymbol),
          missingTokens: missingContracts.map((contract) => contract.token),
        },
      );
    }
    if (quoteInputs.length === 0) continue;

    try {
      const writeResult = await dependencies.appendQuoteSnapshots(quoteInputs);
      result.quoteSnapshotsInserted += writeResult.inserted;
      result.quoteSnapshotsDuplicate += writeResult.duplicates;
      if (
        writeResult.unusable === 0
        && writeResult.inserted + writeResult.duplicates === quoteInputs.length
      ) {
        for (const input of quoteInputs) storedQuoteContracts.add(input.contractId);
      } else {
        for (const input of quoteInputs) quoteFailures.add(input.contractId);
        await recordFailure(
          "OPTION_QUOTE_WRITE_FAILED",
          "option quote write did not account for every usable observation",
          { expiry, batchIndex, requestCount: quoteInputs.length },
        );
      }
    } catch (error) {
      for (const input of quoteInputs) quoteFailures.add(input.contractId);
      await recordFailure("OPTION_QUOTE_WRITE_FAILED", errorMessage(error), {
        expiry,
        batchIndex,
        requestCount: quoteInputs.length,
      });
    }
  }

  if (storedQuoteContracts.size === 0) {
    return failRun(
      new OptionChainIngestionError("OPTION_QUOTES_MISSING", "no usable option quotes were stored"),
      "OPTION_QUOTES_MISSING",
      { expiry, contractCount: canonicalContracts.length },
      !issueCodes.has("OPTION_QUOTES_MISSING"),
    );
  }

  let contractsByGreekKey: Map<string, CanonicalOptionContract>;
  try {
    contractsByGreekKey = indexOptionContractsByGreekKey(canonicalContracts);
  } catch (error) {
    const canonicalIdentityError = error instanceof Error ? error : new Error(errorMessage(error));
    return failRun(canonicalIdentityError, "OPTION_CONTRACT_WRITE_FAILED", {
      expiry,
      contractCount: canonicalContracts.length,
    });
  }
  try {
    const providerGreeks = await dependencies.getGreeks({ name: underlying, expirydate: expiry });
    // Angel One supplies no Greek timestamp; this is MAET's local response-receipt time.
    const observedAt = dependencies.now();
    result.greekRowsFetched = providerGreeks.length;
    const matchedContractIds = new Set<string>();
    const greekByContractId = new Map<string, (typeof providerGreeks)[number]>();
    let mismatchedRows = 0;

    for (const greek of providerGreeks) {
      if (
        greek.name.trim().toUpperCase() !== underlying
        || greek.expiry.trim().toUpperCase() !== expiry
      ) {
        mismatchedRows++;
        continue;
      }
      let greekKey: string;
      try {
        greekKey = getOptionGreekKey(greek.strikePrice, greek.optionType);
      } catch {
        mismatchedRows++;
        continue;
      }
      const contract = contractsByGreekKey.get(greekKey);
      if (!contract || matchedContractIds.has(contract.id)) {
        mismatchedRows++;
        continue;
      }
      if (!hasOptionGreekMarketContent(greek)) continue;
      matchedContractIds.add(contract.id);
      greekByContractId.set(contract.id, greek);
    }

    const greekInputs: OptionGreekSnapshotInput[] = canonicalContracts.flatMap((contract) => {
      const greek = greekByContractId.get(contract.id);
      return greek ? [{ contractId: contract.id, greek }] : [];
    });

    result.greekContractsMatched = matchedContractIds.size;
    result.greekContractsWithoutProviderGreek = canonicalContracts.length - matchedContractIds.size;
    if (mismatchedRows > 0) {
      await recordFailure(
        "OPTION_GREEK_CONTRACT_MISMATCH",
        `${mismatchedRows} provider Greek rows did not match the canonical chain`,
        { expiry, mismatchedRows },
      );
    }
    if (result.greekContractsWithoutProviderGreek > 0) {
      issueCodes.add("OPTION_GREEKS_MISSING");
    }

    if (greekInputs.length > 0) {
      try {
        const writeResult = await dependencies.appendGreekSnapshots(greekInputs, observedAt);
        result.greekSnapshotsInserted += writeResult.inserted;
        if (writeResult.unusable > 0 || writeResult.inserted !== greekInputs.length) {
          await recordFailure(
            "OPTION_GREEK_WRITE_FAILED",
            "option Greek write did not persist every matched observation",
            { expiry, matchedCount: greekInputs.length },
          );
        }
      } catch (error) {
        await recordFailure("OPTION_GREEK_WRITE_FAILED", errorMessage(error), {
          expiry,
          matchedCount: greekInputs.length,
        });
      }
    }
  } catch (error) {
    result.greekContractsWithoutProviderGreek = canonicalContracts.length;
    await recordFailure("OPTION_GREEK_FETCH_FAILED", errorMessage(error), { expiry });
  }

  result.status = issueCodes.size > 0 ? "partial" : "success";
  result.durationMs = dependencies.now().getTime() - startedAt.getTime();
  try {
    await complete(result.status);
  } catch (error) {
    const completionError = error instanceof Error ? error : new Error(errorMessage(error));
    await recordFailure("OPTION_RUN_COMPLETION_FAILED", completionError.message, { expiry });
    try {
      await complete("failed");
    } catch (failedCompletionError) {
      logger.error(
        { err: failedCompletionError, primaryError: completionError, runId },
        "Failed to mark option-chain run failed after completion error",
      );
    }
    throw completionError;
  }
  logger.info(result, "Option-chain ingestion complete");
  return result;
}
