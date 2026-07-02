export const RedisKeys = {
  quoteKey: (exchange: string, symbol: string) => `cache:quote:${exchange}:${symbol}`,
  candlesKey: (exchange: string, symbol: string, tf: string, from: string, to: string) =>
    `cache:candles:${exchange}:${symbol}:${tf}:${from}:${to}`,
  fundamentals: (symbol: string) => `cache:fundamentals:${symbol}`,
  idempotencyKey: (userId: string, key: string) => `idempotency:${userId}:${key}`,
  sseConnKey: (connId: string) => `sse:conn:${connId}`,
  sseSubsKey: (symbol: string) => `sse:subs:${symbol}`,
  ratelimitRestKey: (userId: string, minute: string) => `ratelimit:rest:${userId}:${minute}`,
  screenerCriteriaKey: (exchange: string) => `screener:criteria:${exchange}`,
  angeloneSessionKey: (userId: string) => `angelone:session:${userId}`,
  angeloneSubsKey: (userId: string) => `angelone:subs:${userId}`,
} as const;
