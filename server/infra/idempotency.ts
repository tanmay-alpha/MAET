import { getRedis } from "../data/redis/client";
import { RedisKeys } from "../data/redis/keys";

const TTL_SECONDS = 24 * 60 * 60;
const SENTINEL_PENDING = "__pending__";

export async function withIdempotency<T>(
  userId: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const r = getRedis();
  const redisKey = RedisKeys.idempotencyKey(userId, key);

  const existing = await r.get(redisKey);
  if (existing) {
    if (existing === SENTINEL_PENDING) {
      throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
    }
    return JSON.parse(existing) as T;
  }

  const ok = await r.set(redisKey, SENTINEL_PENDING, "EX", TTL_SECONDS, "NX");
  if (ok !== "OK") {
    const retry = await r.get(redisKey);
    if (retry && retry !== SENTINEL_PENDING) return JSON.parse(retry) as T;
    throw new Error("IDEMPOTENT_REQUEST_IN_FLIGHT");
  }

  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await r.del(redisKey);
    throw e;
  }

  await r.set(redisKey, JSON.stringify(result), "EX", TTL_SECONDS);
  return result;
}
