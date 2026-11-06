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

export function guessMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const find = (...keys: string[]) => normalized.findIndex((header) => keys.some((key) => header.includes(key)));
  return {
    date: find("date", "time"),
    symbol: find("symbol", "ticker", "scrip", "stock"),
    side: find("side", "type", "action", "buy/sell"),
    quantity: find("qty", "quantity", "shares"),
    price: find("price", "rate"),
    tradeId: find("trade id", "trade_id", "order id"),
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

/** Validates each data row on its own; a repeated (symbol, trade id) keeps the first row. */
export function normalizeRows(format: BrokerFormat, headers: readonly string[], rows: readonly CsvRow[], mapping?: ColumnMapping): RowResult[] {
  const extract = extractor(format, headers, mapping);
  const seenIds = new Set<string>();
  return rows.map(({ line, cells }): RowResult => {
    const reject = (reason: string): RowResult => ({ line, cells, status: "rejected", reason });
    const raw = extract(cells);
    if (raw.excluded) return reject(raw.excluded);
    const parsedDate = parseTradeDate(raw.date);
    if (!parsedDate) return reject(`Bad date "${raw.date}"`);
    const symbol = raw.symbol.trim().toUpperCase();
    if (!symbol) return reject("Missing symbol");
    const side = parseSide(raw.side);
    if (!side) return reject(`Unknown side "${raw.side}"`);
    const quantity = parseAmount(raw.quantity);
    if (quantity === 0) return reject("Zero quantity");
    if (quantity === null || quantity < 0) return reject(`Bad quantity "${raw.quantity}"`);
    const price = raw.price(quantity);
    if (price === null || !(price > 0)) return reject("Bad price");
    if (raw.tradeId) {
      const key = JSON.stringify([symbol, raw.tradeId]);
      if (seenIds.has(key)) return { line, cells, status: "duplicate", reason: `Duplicate trade id ${raw.tradeId}` };
      seenIds.add(key);
    }
    return {
      line, cells, status: "accepted",
      trade: { tradeId: raw.tradeId, line, date: parsedDate.date, time: raw.time ?? parsedDate.time, symbol, side, quantity, price },
    };
  });
}
