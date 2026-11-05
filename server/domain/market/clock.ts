import type { MarketPhase } from "@shared/types";

export type { MarketPhase };

const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

function toIstParts(d: Date): { year: number; month: number; day: number; minutes: number; weekday: number } {
  const utcMs = d.getTime();
  const istMs = utcMs + IST_OFFSET_MIN * 60_000;
  const ist = new Date(istMs);
  const weekday = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    minutes,
    weekday,
  };
}

function isSameIstDay(a: Date, b: Date): boolean {
  const A = toIstParts(a);
  const B = toIstParts(b);
  return A.year === B.year && A.month === B.month && A.day === B.day;
}

/** Calendar date in IST as YYYY-MM-DD (independent of the host time zone). */
export function istDateKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** True when `holidays` lists at least one date in `now`'s IST calendar year. */
export function hasHolidaysForIstYear(holidays: Date[], now: Date): boolean {
  const year = istDateKey(now).slice(0, 4);
  return holidays.some((holiday) => istDateKey(holiday).startsWith(year));
}

/** Minutes since IST midnight and IST weekday (0 = Sunday). */
export function istClock(d: Date): { minutes: number; weekday: number } {
  const { minutes, weekday } = toIstParts(d);
  return { minutes, weekday };
}

/** Next instant strictly after `now` whose IST wall-clock time is hour:minute. */
export function nextIstTime(now: Date, hour: number, minute: number): Date {
  const offsetMs = IST_OFFSET_MIN * 60_000;
  const istMidnightUtcMs = Math.floor((now.getTime() + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  let target = istMidnightUtcMs + (hour * 60 + minute) * 60_000;
  if (target <= now.getTime()) target += DAY_MS;
  return new Date(target);
}

export function computePhase(now: Date, holidays: Date[]): MarketPhase {
  const p = toIstParts(now);
  const isHoliday = holidays.some((h) => isSameIstDay(now, h));
  if (isHoliday) return "HOLIDAY";
  if (p.weekday === 0 || p.weekday === 6) return "CLOSED";
  if (p.minutes < 9 * 60) return "CLOSED";
  if (p.minutes < 9 * 60 + 15) return "PRE_OPEN";
  if (p.minutes <= 15 * 60 + 30) return "OPEN";
  if (p.minutes < 16 * 60) return "CLOSED";
  return "AFTER_HOURS";
}

export type ClockOptions = {
  tickMs?: number;
  getNow?: () => Date;
  holidays?: Date[];
};

type PhaseListener = (phase: MarketPhase) => void;

export class MarketClock {
  private listeners: PhaseListener[] = [];
  private lastPhase: MarketPhase | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickMs: number;
  private getNow: () => Date;
  private holidays: Date[];

  constructor(opts: ClockOptions = {}) {
    this.tickMs = opts.tickMs ?? 1000;
    this.getNow = opts.getNow ?? (() => new Date());
    this.holidays = opts.holidays ?? [];
    this.lastPhase = computePhase(this.getNow(), this.holidays);
  }

  subscribe(cb: PhaseListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const phase = computePhase(this.getNow(), this.holidays);
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      for (const l of this.listeners) l(phase);
    }
  }
}
