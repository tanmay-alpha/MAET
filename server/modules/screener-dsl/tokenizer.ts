/**
 * Natural-language screener tokenizer.
 *
 * Converts a raw screener filter string into a sequence of structured tokens.
 */

export enum TokenKind {
  Field = "field",
  Operator = "operator",
  Number = "number",
  String = "string",
  BooleanOp = "boolean_op",
  CapKeyword = "cap_keyword",
  Eof = "eof",
}

export interface Token {
  kind: TokenKind;
  value: string;
  raw: string;
  start: number;
  end: number;
}

export class TokenizeError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
    this.name = "TokenizeError";
  }
}

const FIELD_WORDS: Record<string, string> = {
  pe: "pe_ratio",
  pb: "pb_ratio",
  roe: "roe",
  roce: "roce",
  "revenue growth": "revenue_growth",
  "eps growth": "eps_growth",
  "net margin": "net_margin",
  "gross margin": "gross_margin",
  "debt to equity": "debt_to_equity",
  "debt-to-equity": "debt_to_equity",
  "debt/equity": "debt_to_equity",
  "current ratio": "current_ratio",
  "dividend yield": "dividend_yield",
  "market cap": "market_cap",
  "market-cap": "market_cap",
  price: "price",
  volume: "volume",
  rsi: "rsi",
  macd: "macd",
  "sma cross": "sma_cross",
  "sma-cross": "sma_cross",
  "price above sma": "price_above_sma",
  "volume spike": "volume_spike",
  sector: "sector",
  industry: "industry",
};

const OPERATOR_WORDS = ["crosses above", "crosses below", "above", "below", "between", "within"];
const BOOLEAN_WORDS = ["and", "or", "&", "|"];
const CAP_KEYWORDS = ["large cap", "mid cap", "small cap", "largecap", "midcap", "smallcap"];

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const text = input.trim().toLowerCase();
  let pos = 0;

  while (pos < text.length) {
    // Skip whitespace
    if (/\s/.test(text[pos])) {
      pos++;
      continue;
    }

    // Try multi-word field recognition (longest match first)
    let matched = false;
    const sortedFields = Object.entries(FIELD_WORDS).sort((a, b) => b[0].length - a[0].length);
    for (const [word, field] of sortedFields) {
      if (text.slice(pos, pos + word.length) === word && (pos + word.length >= text.length || /\s/.test(text[pos + word.length]))) {
        tokens.push({ kind: TokenKind.Field, value: field, raw: word, start: pos, end: pos + word.length });
        pos += word.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Cap keywords
    const sortedCaps = [...CAP_KEYWORDS].sort((a, b) => b.length - a.length);
    for (const kw of sortedCaps) {
      if (text.slice(pos, pos + kw.length) === kw) {
        tokens.push({ kind: TokenKind.CapKeyword, value: kw, raw: kw, start: pos, end: pos + kw.length });
        pos += kw.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Operator (longest match first)
    const sortedOps = [...OPERATOR_WORDS].sort((a, b) => b.length - a.length);
    for (const op of sortedOps) {
      if (text.slice(pos, pos + op.length) === op) {
        tokens.push({ kind: TokenKind.Operator, value: op, raw: op, start: pos, end: pos + op.length });
        pos += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Number with optional percent
    const pctRe = /^[\d,]+(?:\.\d+)?\s*%/;
    const pctMatch = text.slice(pos).match(pctRe);
    if (pctMatch) {
      const val = pctMatch[0].trim();
      tokens.push({ kind: TokenKind.Number, value: val, raw: val, start: pos, end: pos + val.length });
      pos += val.length;
      continue;
    }

    // Plain number
    const numRe = /^[\d,]+(?:\.\d+)?/;
    const numMatch = text.slice(pos).match(numRe);
    if (numMatch) {
      const val = numMatch[0];
      tokens.push({ kind: TokenKind.Number, value: val, raw: val, start: pos, end: pos + val.length });
      pos += val.length;
      continue;
    }

    // Boolean connector
    for (const bool of BOOLEAN_WORDS) {
      if (text.slice(pos, pos + bool.length) === bool && (pos + bool.length >= text.length || /\s/.test(text[pos + bool.length]))) {
        tokens.push({ kind: TokenKind.BooleanOp, value: bool, raw: bool, start: pos, end: pos + bool.length });
        pos += bool.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Fallback: treat as unknown string token
    const rest = text.slice(pos);
    const nextSpace = rest.search(/\s/);
    const word = nextSpace === -1 ? rest : rest.slice(0, nextSpace);
    if (word.length > 0) {
      tokens.push({ kind: TokenKind.String, value: word, raw: word, start: pos, end: pos + word.length });
      pos += word.length;
      continue;
    }

    throw new TokenizeError(`Unable to tokenize at position ${pos}`, pos);
  }

  tokens.push({ kind: TokenKind.Eof, value: "", raw: "", start: pos, end: pos });
  return tokens;
}