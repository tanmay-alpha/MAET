const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Delay before the reconnect that follows `failures` consecutive failed attempts
 * (0 = first retry). The ceiling doubles from 1s up to 30s; the delay is drawn from
 * the upper half of that window ("equal jitter") so tabs that lost the stream at the
 * same moment don't reconnect in lockstep, while every retry still waits at least
 * half the ceiling.
 */
export function reconnectDelayMs(failures: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, failures));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** Runs `fn` after `ms`; the returned function cancels it. */
export type ScheduleFn = (fn: () => void, ms: number) => () => void;

export const scheduleTimeout: ScheduleFn = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};
