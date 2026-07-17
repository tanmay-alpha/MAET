/**
 * Batch Runner — Parallel batch processing for all 5000+ companies
 * Processes companies in configurable worker pools with progress tracking
 */

import { getLogger } from "../../../infra/logger";
import type { CalculatorEntry, CalculatorInput, CalculatorOutput } from "./calculator-registry";

const logger = getLogger("batch-runner");

export interface BatchRunnerOptions {
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
  onError?: (symbol: string, error: Error) => void;
  timeoutMs?: number;
}

export interface BatchRunResult {
  symbol: string;
  outputs: CalculatorOutput[];
  durationMs: number;
  error?: string;
}

export interface BatchSummary {
  totalSymbols: number;
  succeeded: number;
  failed: number;
  totalOutputs: number;
  totalDurationMs: number;
}

/**
 * Run a set of calculators against a batch of symbols in parallel.
 * Respects concurrency limit and collects all results.
 */
export async function runBatch(
  symbols: string[],
  calculators: CalculatorEntry[],
  inputFetcher: (symbol: string) => Promise<CalculatorInput>,
  opts: BatchRunnerOptions = {}
): Promise<{ results: BatchRunResult[]; summary: BatchSummary }> {
  const concurrency = opts.concurrency ?? 50;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const startTime = Date.now();
  const results: BatchRunResult[] = [];

  logger.info(
    { symbols: symbols.length, calculators: calculators.length, concurrency },
    "Batch run starting"
  );

  // Process symbols in chunks
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (symbol) => {
        const symbolStart = Date.now();
        try {
          const input = await Promise.race([
            inputFetcher(symbol),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
          ]);

          const outputs: CalculatorOutput[] = [];
          for (const calc of calculators) {
            try {
              const calOutputs = calc.calculate(input);
              outputs.push(...calOutputs);
            } catch (calcErr) {
              logger.warn({ symbol, calculator: calc.meta.name, err: calcErr }, "Calculator failed");
            }
          }

          return {
            symbol,
            outputs,
            durationMs: Date.now() - symbolStart,
          } satisfies BatchRunResult;
        } catch (err) {
          const error = err as Error;
          opts.onError?.(symbol, error);
          return {
            symbol,
            outputs: [],
            durationMs: Date.now() - symbolStart,
            error: error.message,
          } satisfies BatchRunResult;
        }
      })
    );

    for (const res of chunkResults) {
      if (res.status === "fulfilled") {
        results.push(res.value);
      } else {
        const errSymbol = chunk[chunkResults.indexOf(res as any)];
        results.push({ symbol: errSymbol, outputs: [], durationMs: 0, error: (res.reason as Error).message });
      }
    }

    const completed = Math.min(i + concurrency, symbols.length);
    opts.onProgress?.(completed, symbols.length);

    if (i % (concurrency * 10) === 0 && i > 0) {
      logger.info({ completed, total: symbols.length }, "Batch progress");
    }
  }

  const succeeded = results.filter((r) => !r.error).length;
  const totalOutputs = results.reduce((sum, r) => sum + r.outputs.length, 0);

  const summary: BatchSummary = {
    totalSymbols: symbols.length,
    succeeded,
    failed: symbols.length - succeeded,
    totalOutputs,
    totalDurationMs: Date.now() - startTime,
  };

  logger.info(summary, "Batch run complete");
  return { results, summary };
}

/**
 * Run calculators for a single symbol (on-demand mode).
 */
export async function runSingle(
  symbol: string,
  calculators: CalculatorEntry[],
  input: CalculatorInput
): Promise<CalculatorOutput[]> {
  const outputs: CalculatorOutput[] = [];

  for (const calc of calculators) {
    try {
      const calOutputs = calc.calculate(input);
      outputs.push(...calOutputs);
    } catch (err) {
      logger.warn({ symbol, calculator: calc.meta.name, err }, "Calculator failed in single run");
    }
  }

  return outputs;
}
