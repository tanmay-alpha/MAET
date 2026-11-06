import type { CsvRow } from "./csv";
import { parseTradeDate } from "./dates";

export type BrokerFormat = "zerodha" | "groww" | "generic";

export const FORMAT_LABELS: Record<BrokerFormat, string> = {
  zerodha: "Zerodha Console tradebook",
  groww: "Groww order history",
  generic: "Generic CSV (map columns)",
};

/** Column indexes in the header row; tradeId is -1 when the file has none. */
export interface ColumnMapping {
  date: number;
  symbol: number;
  side: number;
  quantity: number;
  price: number;
  tradeId: number;
}

export interface ParsedTrade {
  /** Broker trade/order id, or "" when the file has none. */
  tradeId: string;
  line: number;
  date: string;
  time: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export interface RowResult {
  line: number;
  cells: string[];
  status: "accepted" | "rejected" | "duplicate";
  reason?: string;
  trade?: ParsedTrade;
}

const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/\s+/g, " ");

const ZERODHA_COLUMNS = ["symbol", "trade_date", "trade_type", "quantity", "price"];
const GROWW_COLUMNS = ["stock name", "type", "quantity", "value", "execution date and time"];

export function detectFormat(headers: readonly string[]): Exclude<BrokerFormat, "generic"> | null {
  const present = new Set(headers.map(normalizeHeader));
  if (ZERODHA_COLUMNS.every((column) => present.has(column))) return "zerodha";
  if (GROWW_COLUMNS.every((column) => present.has(column))) return "groww";
  return null;
}

/**
 * An exact header ("Price") wins over one that merely contains a key ("Strike
 * Price"), and earlier keys win over later ones ("Trade Date" over "Trade Time").
 */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const find = (...keys: string[]) => {
    for (const key of keys) if (normalized.includes(key)) return normalized.indexOf(key);
    for (const key of keys) {
      const partial = normalized.findIndex((header) => header.includes(key));
      if (partial >= 0) return partial;
    }
    return -1;
  };
  return {
    date: find("date", "time"),
    symbol: find("symbol", "ticker", "scrip", "stock"),
    side: find("side", "type", "action", "buy/sell"),
    quantity: find("qty", "quantity", "shares"),
    price: find("price", "rate"),
    tradeId: find("trade id", "trade_id", "trade num", "trade no", "order id"),
  };
}

export const isMappingComplete = (mapping: ColumnMapping) =>
  [mapping.date, mapping.symbol, mapping.side, mapping.quantity, mapping.price].every((index) => index >= 0);

/** Indian-formatted numbers: "₹1,23,456.50" → 123456.5. */
export function parseAmount(text: string | undefined): number | null {
  const cleaned = (text ?? "").replace(/[₹,\s]/g, "");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(cleaned) ? Number(cleaned) : null;
}

function parseSide(text: string): "BUY" | "SELL" | null {
  const side = text.trim().toUpperCase();
  if (side === "BUY" || side === "B") return "BUY";
  if (side === "SELL" || side === "S") return "SELL";
  return null;
}

interface RawTrade {
  date: string;
  time?: string;
  symbol: string;
  side: string;
  quantity: string;
  /** Groww reports order value, not price; it is resolved after quantity is known. */
  price: (quantity: number) => number | null;
  tradeId: string;
  excluded?: string;
}

function extractor(format: BrokerFormat, headers: readonly string[], mapping?: ColumnMapping): (cells: string[]) => RawTrade {
  const normalized = headers.map(normalizeHeader);
  const column = (name: string) => normalized.indexOf(name);
  if (format === "zerodha") {
    const [symbol, date, side, quantity, price, tradeId, segment, executed] =
      ["symbol", "trade_date", "trade_type", "quantity", "price", "trade_id", "segment", "order_execution_time"].map(column);
    return (cells) => {
      const segmentValue = (cells[segment!] ?? "").toUpperCase();
      return {
        date: cells[date!] ?? "",
        time: parseTradeDate(cells[executed!] ?? "")?.time,
        symbol: cells[symbol!] ?? "",
        side: cells[side!] ?? "",
        quantity: cells[quantity!] ?? "",
        price: () => parseAmount(cells[price!]),
        tradeId: cells[tradeId!] ?? "",
        excluded: segmentValue === "FO" || segmentValue === "NFO" ? "F&O segment excluded"
          : segmentValue && segmentValue !== "EQ" ? `${segmentValue} segment excluded` : undefined,
      };
    };
  }
  if (format === "groww") {
    const [name, symbol, side, quantity, value, orderId, executed, status] =
      ["stock name", "symbol", "type", "quantity", "value", "exchange order id", "execution date and time", "order status"].map(column);
    return (cells) => {
      const statusValue = cells[status!] ?? "";
      const orderValue = parseAmount(cells[value!]);
      return {
        date: cells[executed!] ?? "",
        symbol: cells[symbol!] || cells[name!] || "",
        side: cells[side!] ?? "",
        quantity: cells[quantity!] ?? "",
        price: (units) => (orderValue === null ? null : orderValue / units),
        tradeId: cells[orderId!] ?? "",
        excluded: statusValue && statusValue.toLowerCase() !== "executed" ? `Order status "${statusValue}" excluded` : undefined,
      };
    };
  }
  if (!mapping || !isMappingComplete(mapping)) throw new Error("Generic CSV needs date, symbol, side, quantity and price columns");
  return (cells) => ({
    date: cells[mapping.date] ?? "",
    symbol: cells[mapping.symbol] ?? "",
    side: cells[mapping.side] ?? "",
    quantity: cells[mapping.quantity] ?? "",
    price: () => parseAmount(cells[mapping.price]),
    tradeId: mapping.tradeId >= 0 ? cells[mapping.tradeId] ?? "" : "",
  });
}

/**
 * One demat holding per company: Yahoo-style exchange suffixes (.NS, .BO) and
 * NSE series suffixes (EQ rolling, BE/BZ trade-for-trade, BL block window,
 * SM/ST SME) name the same share. Hyphens inside a symbol (BAJAJ-AUTO) stay.
 */
export function normalizeSymbol(text: string): string {
  return text.trim().toUpperCase().replace(/\.(NS|BO)$/, "").replace(/-(EQ|BE|BZ|BL|SM|ST)$/, "");
}

/** Cells up to the last non-empty one: trailing empties are padding some exports add, not data. */
function filledWidth(cells: readonly string[]): number {
  let width = cells.length;
  while (width > 0 && cells[width - 1] === "") width -= 1;
  return width;
}

/**
 * Validates each data row on its own. A trade id repeated on the same day for
 * the same symbol is a duplicate (overlapping exports) when side, quantity and
 * price match the first row, and a conflict otherwise; the first row is kept.
 */
export function normalizeRows(format: BrokerFormat, headers: readonly string[], rows: readonly CsvRow[], mapping?: ColumnMapping): RowResult[] {
  const extract = extractor(format, headers, mapping);
  const seenIds = new Map<string, ParsedTrade>();
  const headerWidth = filledWidth(headers);
  return rows.map(({ line, cells }): RowResult => {
    const reject = (reason: string): RowResult => ({ line, cells, status: "rejected", reason });
    // An unquoted "1,234.50" or a dropped cell shifts every later column; nothing in the row can be trusted.
    const width = filledWidth(cells);
    if (cells.length < headerWidth || width > headers.length) {
      return reject(`Row has ${cells.length < headerWidth ? cells.length : width} columns; the header has ${headerWidth}`);
    }
    const raw = extract(cells);
    if (raw.excluded) return reject(raw.excluded);
    const parsedDate = parseTradeDate(raw.date);
    if (!parsedDate) return reject(`Bad date "${raw.date}"`);
    const symbol = normalizeSymbol(raw.symbol);
    if (!symbol) return reject("Missing symbol");
    const side = parseSide(raw.side);
    if (!side) return reject(`Unknown side "${raw.side}"`);
    const quantity = parseAmount(raw.quantity);
    if (quantity === 0) return reject("Zero quantity");
    if (quantity === null || quantity < 0) return reject(`Bad quantity "${raw.quantity}"`);
    // Float residue (0.3 - 0.1 < 0.2) would otherwise reject a valid sell as an oversell.
    if (!Number.isInteger(quantity)) return reject(`Fractional quantity ${quantity}; NSE/BSE shares trade in whole units`);
    const price = raw.price(quantity);
    if (price === null || !(price > 0)) return reject("Bad price");
    const trade: ParsedTrade = { tradeId: raw.tradeId, line, date: parsedDate.date, time: raw.time ?? parsedDate.time, symbol, side, quantity, price };
    if (raw.tradeId) {
      const key = JSON.stringify([symbol, trade.date, raw.tradeId]);
      const first = seenIds.get(key);
      if (first && first.side === side && first.quantity === quantity && first.price === price) {
        return { line, cells, status: "duplicate", reason: `Duplicate trade id ${raw.tradeId}` };
      }
      if (first) return reject(`Trade id ${raw.tradeId} repeats line ${first.line} with a different side, quantity or price`);
      seenIds.set(key, trade);
    }
    return { line, cells, status: "accepted", trade };
  });
}
