import { getDb } from "../../data/drizzle/client";
import { isRetryableDatabaseError } from "./errors";
import { createPostgresPaperRepositories } from "./postgres-repository";
import type { PaperTransaction, PaperTradingRepositories } from "./repository";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSerializablePaperTransaction<T>(
  operation: (
    repositories: PaperTradingRepositories,
    tx: PaperTransaction,
    attempt: number
  ) => Promise<T>
): Promise<T> {
  const database = getDb();
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await database.transaction(
        async (tx) => {
          const repositories = createPostgresPaperRepositories(tx);
          return await operation(repositories, tx, attempt);
        },
        {
          isolationLevel: "serializable",
        }
      );
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = attempt === 1 ? 20 : 50;
      await sleep(delayMs);
    }
  }

  throw new Error("Transaction execution reached unreachable state");
}
