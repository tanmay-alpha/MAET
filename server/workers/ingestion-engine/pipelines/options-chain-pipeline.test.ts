import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AngelOneFullMarketQuoteRequest,
  AngelOneOptionContract,
  AngelOneOptionGreek,
} from "../../../data/sources/angelone/client";
import type {
  CanonicalOptionContract,
  OptionGreekSnapshotInput,
  OptionQuoteSnapshotInput,
} from "../../../modules/options/repository";
import {
  OptionChainIngestionError,
  runOptionChainIngestion,
  type OptionChainPipelineDependencies,
} from "./options-chain-pipeline";

function providerContract(index: number): AngelOneOptionContract {
  const strike = 24_000 + Math.floor(index / 2) * 50;
  const optionType = index % 2 === 0 ? "CE" : "PE";
  return {
    token: String(10_000 + index),
    tradingSymbol: `NIFTY28AUG26${strike}${optionType}`,
    name: "NIFTY",
    expiry: "28AUG2026",
    strikePrice: strike,
    optionType,
    lotSize: 75,
    instrumentType: "OPTIDX",
  };
}

function canonicalContract(contract: AngelOneOptionContract, index: number): CanonicalOptionContract {
  return {
    id: `contract-${index}`,
    token: contract.token,
    tradingSymbol: contract.tradingSymbol,
    strikePrice: contract.strikePrice.toFixed(4),
    optionType: contract.optionType,
    instrumentType: contract.instrumentType,
  };
}

function greekFor(contract: CanonicalOptionContract): AngelOneOptionGreek {
  return {
    name: "NIFTY",
    expiry: "28AUG2026",
    strikePrice: Number(contract.strikePrice),
    optionType: contract.optionType,
    delta: contract.optionType === "CE" ? 0.4 : -0.4,
  };
}

function createHarness(contractCount = 2) {
  const resolvedContracts = Array.from({ length: contractCount }, (_, index) => providerContract(index));
  const syncedContracts = resolvedContracts.map(canonicalContract);
  let clockMs = Date.parse("2026-08-31T09:00:00.000Z");
  const quoteRequests: AngelOneFullMarketQuoteRequest[][] = [];
  const quoteRequestStarts: number[] = [];
  const quoteWrites: OptionQuoteSnapshotInput[][] = [];
  const greekWrites: Array<{ inputs: OptionGreekSnapshotInput[]; observedAt: Date }> = [];
  const sleeps: number[] = [];
  const starts: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  const dlqEntries: Array<Record<string, unknown>> = [];
  let greekCalls = 0;

  const dependencies: OptionChainPipelineDependencies = {
    hasMarketSession: () => true,
    resolveContracts: async () => resolvedContracts,
    syncContracts: async () => syncedContracts,
    getFullQuotes: async (requests) => {
      quoteRequests.push(requests);
      quoteRequestStarts.push(clockMs);
      return requests.map((request, index) => ({
        ...request,
        ltp: 100 + index,
        volume: 0,
        exchangeFeedAt: new Date(clockMs + index).toISOString(),
      }));
    },
    appendQuoteSnapshots: async (inputs) => {
      quoteWrites.push(inputs);
      return { attempted: inputs.length, inserted: inputs.length, duplicates: 0, unusable: 0 };
    },
    getGreeks: async () => {
      greekCalls++;
      return syncedContracts.map(greekFor);
    },
    appendGreekSnapshots: async (inputs, observedAt) => {
      greekWrites.push({ inputs, observedAt });
      return { attempted: inputs.length, inserted: inputs.length, duplicates: 0, unusable: 0 };
    },
    startRun: async (options) => { starts.push(options); },
    completeRun: async (options) => { completions.push(options); },
    pushToDLQ: async (entry) => { dlqEntries.push(entry); },
    now: () => new Date(clockMs),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clockMs += milliseconds;
    },
  };

  return {
    dependencies,
    resolvedContracts,
    syncedContracts,
    quoteRequests,
    quoteRequestStarts,
    quoteWrites,
    greekWrites,
    sleeps,
    starts,
    completions,
    dlqEntries,
    getGreekCalls: () => greekCalls,
    advanceClock: (milliseconds: number) => { clockMs += milliseconds; },
  };
}

describe("option-chain ingestion pipeline", () => {
  it("normalizes identity, starts one run, and returns complete counters", async () => {
    const harness = createHarness();

    const ingestion = await runOptionChainIngestion(
      { underlying: " nifty ", expiry: " 28aug2026 " },
      harness.dependencies,
    );

    expect(ingestion).toEqual({
      runId: expect.stringMatching(
        /^options-NIFTY-28AUG2026-2026-08-31T09-00-00-000Z-[0-9a-f-]{36}$/u,
      ),
      status: "success",
      underlying: "NIFTY",
      expiry: "28AUG2026",
      contractsResolved: 2,
      contractsSynced: 2,
      quoteBatches: 1,
      quotesFetched: 2,
      quoteSnapshotsInserted: 2,
      quoteSnapshotsDuplicate: 0,
      quoteContractsMissing: 0,
      greekRowsFetched: 2,
      greekContractsMatched: 2,
      greekSnapshotsInserted: 2,
      greekContractsWithoutProviderGreek: 0,
      durationMs: 0,
    });
    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0]).toMatchObject({
      source: "angelone",
      pipeline: "options-chain",
      metadata: {
        provider: "angelone",
        exchange: "NFO",
        underlying: "NIFTY",
        expiry: "28AUG2026",
      },
    });
    expect(harness.getGreekCalls()).toBe(1);
    expect(harness.completions[0]).toMatchObject({
      status: "success",
      symbolsAttempted: 2,
      symbolsSucceeded: 2,
      symbolsFailed: 0,
      recordsInserted: 4,
    });
  });

  it("rejects invalid input before starting a run", async () => {
    const harness = createHarness();

    await expect(runOptionChainIngestion(
      { underlying: " ", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("underlying must not be empty");
    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "2026-08-28" },
      harness.dependencies,
    )).rejects.toThrow("valid DDMMMYYYY expiry");
    expect(harness.starts).toEqual([]);
  });

  it("fails explicitly without an active market session and records the run and DLQ", async () => {
    const harness = createHarness();
    harness.dependencies.hasMarketSession = () => false;

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toBeInstanceOf(OptionChainIngestionError);

    expect(harness.quoteRequests).toEqual([]);
    expect(harness.completions[0]).toMatchObject({ status: "failed", symbolsAttempted: 0 });
    expect(harness.dlqEntries[0]).toMatchObject({
      source: "angelone",
      pipeline: "options-chain",
      batchId: harness.starts[0].runId,
      symbol: "NIFTY",
      errorCode: "OPTION_SESSION_UNAVAILABLE",
    });
  });

  it("fails a started run when contract resolution returns no contracts", async () => {
    const harness = createHarness(0);

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("no option contracts");

    expect(harness.completions[0]).toMatchObject({ status: "failed", symbolsAttempted: 0 });
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_CONTRACTS_UNAVAILABLE" });
  });

  it.each([
    [50, [50]],
    [51, [50, 1]],
    [101, [50, 50, 1]],
  ])("batches %i contracts into provider requests no larger than 50", async (contractCount, sizes) => {
    const harness = createHarness(contractCount);

    await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(harness.quoteRequests.map((batch) => batch.length)).toEqual(sizes);
  });

  it("batches at 50, starts sequential requests at least one second apart, and does not sleep after the final request", async () => {
    const harness = createHarness(101);

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(harness.quoteRequests.map((batch) => batch.length)).toEqual([50, 50, 1]);
    expect(harness.quoteRequestStarts).toEqual([
      Date.parse("2026-08-31T09:00:00.000Z"),
      Date.parse("2026-08-31T09:00:01.000Z"),
      Date.parse("2026-08-31T09:00:02.000Z"),
    ]);
    expect(harness.sleeps).toEqual([1_000, 1_000]);
    expect(ingestion.quoteBatches).toBe(3);
    expect(ingestion.durationMs).toBe(2_000);
  });

  it("shares quote-start spacing across concurrent pipeline invocations and keeps run IDs distinct", async () => {
    const harness = createHarness();

    const [firstRun, secondRun] = await Promise.all([
      runOptionChainIngestion(
        { underlying: "NIFTY", expiry: "28AUG2026" },
        harness.dependencies,
      ),
      runOptionChainIngestion(
        { underlying: "NIFTY", expiry: "28AUG2026" },
        harness.dependencies,
      ),
    ]);

    expect(firstRun.runId).not.toBe(secondRun.runId);
    expect(firstRun.runId).toStartWith("options-NIFTY-28AUG2026-");
    expect(secondRun.runId).toStartWith("options-NIFTY-28AUG2026-");
    expect(harness.quoteRequestStarts).toEqual([
      Date.parse("2026-08-31T09:00:00.000Z"),
      Date.parse("2026-08-31T09:00:01.000Z"),
    ]);
    expect(harness.sleeps).toEqual([1_000]);
  });

  it("orders requests deterministically by strike, CE before PE, then identity", async () => {
    const harness = createHarness(4);
    harness.dependencies.syncContracts = async () => [
      harness.syncedContracts[3],
      harness.syncedContracts[1],
      harness.syncedContracts[2],
      harness.syncedContracts[0],
    ];

    await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(harness.quoteRequests[0].map((request) => request.tradingSymbol)).toEqual([
      harness.syncedContracts[0].tradingSymbol,
      harness.syncedContracts[1].tradingSymbol,
      harness.syncedContracts[2].tradingSymbol,
      harness.syncedContracts[3].tradingSymbol,
    ]);
  });

  it("continues after one quote batch fails and reports a correlated partial run", async () => {
    const harness = createHarness(51);
    let calls = 0;
    const successfulQuoteFetch = harness.dependencies.getFullQuotes;
    harness.dependencies.getFullQuotes = async (requests) => {
      calls++;
      if (calls === 1) throw new Error("provider unavailable");
      return successfulQuoteFetch(requests);
    };

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.quoteSnapshotsInserted).toBe(1);
    expect(ingestion.quoteContractsMissing).toBe(50);
    expect(harness.dlqEntries[0]).toMatchObject({
      errorCode: "OPTION_QUOTE_FETCH_FAILED",
      batchId: harness.starts[0].runId,
      symbol: "NIFTY",
      rawPayload: {
        requestCount: 50,
        requestedTradingSymbols: harness.syncedContracts.slice(0, 50).map((contract) => contract.tradingSymbol),
        requestedTokens: harness.syncedContracts.slice(0, 50).map((contract) => contract.token),
      },
    });
    expect(harness.completions[0]).toMatchObject({
      status: "partial",
      symbolsAttempted: 51,
      symbolsSucceeded: 1,
      symbolsFailed: 50,
    });
  });

  it("fails after continuing through quote batches when none produce a stored observation", async () => {
    const harness = createHarness(51);
    let fetchCalls = 0;
    harness.dependencies.getFullQuotes = async () => {
      fetchCalls++;
      throw new Error("provider unavailable");
    };

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("no usable option quotes");

    expect(harness.completions[0]).toMatchObject({
      status: "failed",
      symbolsAttempted: 51,
      symbolsSucceeded: 0,
      symbolsFailed: 51,
    });
    expect(fetchCalls).toBe(2);
    expect(harness.getGreekCalls()).toBe(0);
  });

  it("treats missing or content-free quote rows as unavailable, never as zero", async () => {
    const harness = createHarness();
    harness.dependencies.getFullQuotes = async (requests) => [{
      ...requests[0],
      exchangeFeedAt: "2026-08-31T09:00:00.000Z",
    }];

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("no usable option quotes");

    expect(harness.quoteWrites).toEqual([]);
    expect(harness.completions[0]).toMatchObject({ symbolsFailed: 2 });
  });

  it("records verified missing quote identities and reports partial when another quote remains usable", async () => {
    const harness = createHarness();
    harness.dependencies.getFullQuotes = async (requests) => [{
      ...requests[0],
      ltp: 100,
      exchangeFeedAt: "2026-08-31T09:00:00.000Z",
    }];

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.quoteContractsMissing).toBe(1);
    expect(harness.dlqEntries[0]).toMatchObject({
      errorCode: "OPTION_QUOTES_MISSING",
      rawPayload: {
        missingTradingSymbols: [harness.syncedContracts[1].tradingSymbol],
        missingTokens: [harness.syncedContracts[1].token],
      },
    });
  });

  it("counts quote conflict duplicates as successful observations", async () => {
    const harness = createHarness();
    harness.dependencies.appendQuoteSnapshots = async (inputs) => ({
      attempted: inputs.length,
      inserted: 0,
      duplicates: inputs.length,
      unusable: 0,
    });

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("success");
    expect(ingestion.quoteSnapshotsDuplicate).toBe(2);
    expect(harness.completions[0]).toMatchObject({ symbolsSucceeded: 2, symbolsFailed: 0 });
  });

  it("calls the Greek endpoint once, matches canonical keys, and timestamps at local receipt", async () => {
    const harness = createHarness();
    const receivedAt = new Date("2026-08-31T09:00:07.000Z");
    harness.dependencies.getGreeks = async () => {
      harness.advanceClock(7_000);
      return [greekFor(harness.syncedContracts[1]), greekFor(harness.syncedContracts[0])];
    };

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(harness.getGreekCalls()).toBe(0);
    expect(harness.greekWrites).toHaveLength(1);
    expect(harness.greekWrites[0].observedAt).toEqual(receivedAt);
    expect(harness.greekWrites[0].inputs.map((input) => input.contractId)).toEqual([
      harness.syncedContracts[0].id,
      harness.syncedContracts[1].id,
    ]);
    expect(ingestion.greekContractsMatched).toBe(2);
  });

  it("rejects wrong provider identity and all-null Greeks without fabricating coverage", async () => {
    const harness = createHarness();
    harness.dependencies.getGreeks = async () => [{
      ...greekFor(harness.syncedContracts[0]),
      name: "BANKNIFTY",
    }, {
      ...greekFor(harness.syncedContracts[1]),
      delta: undefined,
    }, {
      ...greekFor(harness.syncedContracts[0]),
      expiry: "04SEP2026",
    }];

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.greekRowsFetched).toBe(3);
    expect(ingestion.greekContractsMatched).toBe(0);
    expect(ingestion.greekContractsWithoutProviderGreek).toBe(2);
    expect(harness.greekWrites).toEqual([]);
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_GREEK_CONTRACT_MISMATCH" });
  });

  it("keeps CE and PE distinct and rejects an unknown Greek strike", async () => {
    const harness = createHarness();
    harness.dependencies.getGreeks = async () => [{
      ...greekFor(harness.syncedContracts[0]),
      strikePrice: 99_999,
    }, greekFor(harness.syncedContracts[1])];

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.greekContractsMatched).toBe(1);
    expect(harness.greekWrites[0].inputs).toEqual([{
      contractId: harness.syncedContracts[1].id,
      greek: greekFor(harness.syncedContracts[1]),
    }]);
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_GREEK_CONTRACT_MISMATCH" });
  });

  it("keeps quote success and completes partial when the one Greek request fails", async () => {
    const harness = createHarness();
    harness.dependencies.getGreeks = async () => { throw new Error("Greek provider unavailable"); };

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.quoteSnapshotsInserted).toBe(2);
    expect(ingestion.greekContractsWithoutProviderGreek).toBe(2);
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_GREEK_FETCH_FAILED" });
    expect(harness.completions[0]).toMatchObject({
      status: "partial",
      symbolsSucceeded: 2,
      recordsInserted: 2,
    });
  });

  it("reports partial and preserves quote records when Greek persistence fails", async () => {
    const harness = createHarness();
    harness.dependencies.appendGreekSnapshots = async () => { throw new Error("Greek write failed"); };

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.quoteSnapshotsInserted).toBe(2);
    expect(ingestion.greekSnapshotsInserted).toBe(0);
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_GREEK_WRITE_FAILED" });
  });

  it("preserves a normal completion error and makes a correlated failed-run attempt", async () => {
    const harness = createHarness();
    let completionCalls = 0;
    harness.dependencies.completeRun = async (options) => {
      completionCalls++;
      if (completionCalls === 1) throw new Error("completion unavailable");
      harness.completions.push(options);
    };

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("completion unavailable");

    expect(completionCalls).toBe(2);
    expect(harness.completions[0]).toMatchObject({ status: "failed" });
    expect(harness.dlqEntries[0]).toMatchObject({
      errorCode: "OPTION_RUN_COMPLETION_FAILED",
      batchId: harness.starts[0].runId,
    });
  });

  it("continues past quote persistence failures when another batch succeeds", async () => {
    const harness = createHarness(51);
    let writes = 0;
    const successfulWrite = harness.dependencies.appendQuoteSnapshots;
    harness.dependencies.appendQuoteSnapshots = async (inputs) => {
      writes++;
      if (writes === 1) throw new Error("database unavailable");
      return successfulWrite(inputs);
    };

    const ingestion = await runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    );

    expect(ingestion.status).toBe("partial");
    expect(ingestion.quoteContractsMissing).toBe(0);
    expect(harness.dlqEntries[0]).toMatchObject({ errorCode: "OPTION_QUOTE_WRITE_FAILED" });
    expect(harness.completions[0]).toMatchObject({ symbolsFailed: 50, symbolsSucceeded: 1 });
  });

  it("records resolution and contract persistence failures with specific error codes", async () => {
    for (const scenario of [
      { method: "resolveContracts", code: "OPTION_CONTRACT_RESOLUTION_FAILED" },
      { method: "syncContracts", code: "OPTION_CONTRACT_WRITE_FAILED" },
    ] as const) {
      const harness = createHarness();
      harness.dependencies[scenario.method] = async () => { throw new Error("stage failed"); };

      await expect(runOptionChainIngestion(
        { underlying: "NIFTY", expiry: "28AUG2026" },
        harness.dependencies,
      )).rejects.toThrow("stage failed");
      expect(harness.dlqEntries[0]).toMatchObject({ errorCode: scenario.code });
      expect(harness.completions[0]).toMatchObject({ status: "failed" });
    }
  });

  it("preserves a fatal domain error when both DLQ and failed-run completion reject", async () => {
    const harness = createHarness();
    harness.dependencies.hasMarketSession = () => false;
    harness.dependencies.pushToDLQ = async () => { throw new Error("DLQ unavailable"); };
    harness.dependencies.completeRun = async () => { throw new Error("completion unavailable"); };

    try {
      await runOptionChainIngestion(
        { underlying: "NIFTY", expiry: "28AUG2026" },
        harness.dependencies,
      );
      throw new Error("expected option-chain ingestion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(OptionChainIngestionError);
      expect((error as OptionChainIngestionError).errorCode).toBe("OPTION_SESSION_UNAVAILABLE");
    }
  });

  it("fails and correlates duplicate canonical Greek identities through the run lifecycle", async () => {
    const harness = createHarness();
    harness.dependencies.syncContracts = async () => [{
      ...harness.syncedContracts[0],
    }, {
      ...harness.syncedContracts[1],
      strikePrice: harness.syncedContracts[0].strikePrice,
      optionType: harness.syncedContracts[0].optionType,
    }];

    await expect(runOptionChainIngestion(
      { underlying: "NIFTY", expiry: "28AUG2026" },
      harness.dependencies,
    )).rejects.toThrow("duplicate canonical option contract");

    expect(harness.completions[0]).toMatchObject({ status: "failed" });
    expect(harness.dlqEntries[0]).toMatchObject({
      errorCode: "OPTION_CONTRACT_WRITE_FAILED",
      batchId: harness.starts[0].runId,
    });
  });

  it("does not expose rho, provider Greek timestamps, parallel quote calls, or legacy option-chain writes", () => {
    const pipelineSource = readFileSync(join(import.meta.dir, "options-chain-pipeline.ts"), "utf8");
    expect(pipelineSource).not.toMatch(/\brho\b/u);
    expect(pipelineSource).not.toContain("Promise.all");
    expect(pipelineSource).not.toMatch(/option_chain(?!_)/u);
    expect(pipelineSource).not.toContain("exchangeFeedAt: observedAt");
  });
});
