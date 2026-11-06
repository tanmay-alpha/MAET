export const RedisKeys = {
  quoteKey: (exchange: string, symbol: string) => `cache:quote:${exchange}:${symbol}`,
  candlesKey: (exchange: string, symbol: string, tf: string, from: string, to: string) =>
    `cache:candles:${exchange}:${symbol}:${tf}:${from}:${to}`,
  fundamentals: (symbol: string) => `cache:fundamentals:${symbol}`,
  screenerCriteriaKey: (exchange: string) => `screener:criteria:${exchange}`,
  angeloneSessionKey: (userId: string) => `angelone:session:${userId}`,
  angeloneSubsKey: (userId: string) => `angelone:subs:${userId}`,
  dailyProcessorLockKey: (istDate: string) => `lock:daily-processor:${istDate}`,
  dailyProcessorDoneKey: (istDate: string) => `done:daily-processor:${istDate}`,
} as const;
