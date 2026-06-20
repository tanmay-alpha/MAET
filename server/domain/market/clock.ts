export type MarketPhase = "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "AFTER_HOURS";

const IST_OFFSET_MIN = 330;

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
