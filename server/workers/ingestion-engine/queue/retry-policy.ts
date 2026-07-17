/**
 * Retry Policy — Exponential backoff configuration per source
 */

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryableErrorCodes: string[];
}

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 3,
  retryableErrorCodes: ["FETCH_FAILED", "RATE_LIMITED", "TIMEOUT", "SERVER_ERROR"],
};

export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  "nse-equities": {
    ...DEFAULT_POLICY,
    maxRetries: 3,
    initialDelayMs: 2_000,
    maxDelayMs: 60_000,
  },
  "yahoo-history": {
    ...DEFAULT_POLICY,
    maxRetries: 3,
    initialDelayMs: 3_000,
    maxDelayMs: 30_000,
  },
  "angel-one-quotes": {
    ...DEFAULT_POLICY,
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5_000,
  },
  "corporate-actions": {
    ...DEFAULT_POLICY,
    maxRetries: 3,
  },
  "fundamentals": {
    ...DEFAULT_POLICY,
    maxRetries: 3,
    initialDelayMs: 5_000,
    maxDelayMs: 60_000,
  },
};

export function getRetryPolicy(source: string): RetryPolicy {
  return RETRY_POLICIES[source] ?? DEFAULT_POLICY;
}

export function calculateBackoffMs(policy: RetryPolicy, attempt: number): number {
  const delay = policy.initialDelayMs * Math.pow(policy.backoffFactor, attempt);
  return Math.min(delay, policy.maxDelayMs);
}

export function isRetryable(policy: RetryPolicy, errorCode: string): boolean {
  return policy.retryableErrorCodes.includes(errorCode);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  source: string,
  operationName: string
): Promise<T> {
  const policy = getRetryPolicy(source);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < policy.maxRetries) {
        const delay = calculateBackoffMs(policy, attempt);
        console.warn(
          `[retry-policy] ${source}/${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
          (err as Error).message
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
