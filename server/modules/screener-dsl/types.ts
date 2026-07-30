/**
 * Token types used by the screener tokenizer and parser.
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

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
    public expected?: string,
  ) {
    super(`Parse error at position ${pos}: ${message}`);
    this.name = "ParseError";
  }
}