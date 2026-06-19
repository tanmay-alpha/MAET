import type { Candle } from "@shared/types";
import type { CorporateAction } from "../../data/sources/nse";

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function adjustForCorporateAction(candle: Candle, action: CorporateAction): Candle {
  if (action.action === "SPLIT" && action.ratio && action.ratio > 1) {
    const factor = action.ratio;
    return {
      ...candle,
      open: candle.open / factor,
      high: candle.high / factor,
      low: candle.low / factor,
      close: candle.close / factor,
      volume: Math.round(candle.volume * factor),
    };
  }
  if (action.action === "BONUS" && action.ratio) {
    const factor = 1 + action.ratio;
    return { ...candle, volume: Math.round(candle.volume * factor) };
  }
  return candle;
}

export function normalizeAndFillGaps(
  raw: Candle[],
  from: Date,
  to: Date,
  tf: "1m" | "1d",
  actions: CorporateAction[]
): Candle[] {
  const splitAdjust = (c: Candle): Candle => {
    let cur = c;
    for (const a of actions) {
      if (new Date(a.exDate) > new Date(c.ts)) {
        cur = adjustForCorporateAction(cur, a);
      }
    }
    return cur;
  };
  const adjusted = raw.map(splitAdjust);

  if (tf !== "1d") return adjusted.sort((a, b) => a.ts.localeCompare(b.ts));

  const byDay = new Map<string, Candle>();
  for (const c of adjusted) byDay.set(dayKey(c.ts), c);

  const lastClose = (() => {
    const sorted = [...adjusted].sort((a, b) => a.ts.localeCompare(b.ts));
    return sorted[0]?.close ?? 0;
  })();

  const out: Candle[] = [];
  let prevClose = lastClose;
  for (const d of eachDay(from, to)) {
    const c = byDay.get(d);
    if (c) {
      out.push(c);
      prevClose = c.close;
    } else {
      out.push({
        symbol: adjusted[0]?.symbol ?? "X",
        tf: "1d",
        ts: `${d}T00:00:00.000Z`,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      });
    }
  }
  return out;
}
