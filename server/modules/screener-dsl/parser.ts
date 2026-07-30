/**
 * Natural-language screener parser.
 *
 * Recursive descent parser consuming tokens from the tokenizer.
 * Produces an AST that the compiler later turns into the validated screener filter AST.
 */

import { tokenize } from "./tokenizer";
import { TokenKind, type Token, TokenizeError } from "./tokenizer";
import { ParseError } from "./types";
import type { NlNode, NlField, NlOperator } from "@shared/screener/ast";

export class ParseResult {
  constructor(
    public success: boolean,
    public ast: NlNode | null,
    public error: ParseError | null,
  ) {}
}

export class ScreenerDslParser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(input: string): ParseResult {
    try {
      this.tokens = tokenize(input);
      this.pos = 0;
      const node = this.parseExpression();
      this.consume(TokenKind.Eof, "end of expression");
      return new ParseResult(true, node, null);
    } catch (err) {
      if (err instanceof TokenizeError) {
        return new ParseResult(false, null, new ParseError(err.message, err.pos));
      }
      if (err instanceof ParseError) {
        return new ParseResult(false, null, err);
      }
      throw err;
    }
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.Eof, value: "", raw: "", start: 0, end: 0 };
  }

  private advance(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private consume(expectedKind: TokenKind, expectedLabel: string): Token {
    const t = this.peek();
    if (t.kind !== expectedKind) {
      throw new ParseError(`Expected ${expectedLabel}, got ${t.raw}`, t.start, expectedKind);
    }
    this.advance();
    return t;
  }

  private parseExpression(): NlNode {
    return this.parseOrExpression();
  }

  private parseOrExpression(): NlNode {
    let node = this.parseAndExpression();
    while (this.peek().kind === TokenKind.BooleanOp && this.peek().value === "or") {
      this.advance();
      node = { kind: "composite", op: "or", children: [node, this.parseAndExpression()] };
    }
    return node;
  }

  private parseAndExpression(): NlNode {
    let node = this.parsePrimary();
    while (this.peek().kind === TokenKind.BooleanOp && this.peek().value === "and") {
      this.advance();
      node = { kind: "composite", op: "and", children: [node, this.parsePrimary()] };
    }
    return node;
  }

  private parsePrimary(): NlNode {
    // Optional cap keyword
    let capKeyword: string | undefined;
    if (this.peek().kind === TokenKind.CapKeyword) {
      capKeyword = this.advance().value;
    }

    // field op value structure
    const fieldToken = this.consume(TokenKind.Field, "field name");
    const op = this.consume(TokenKind.Operator, "operator");

    let value: number | string;
    if (op.value === "between") {
      const v1 = this.parseNumberOrString();
      this.consume(TokenKind.String, "'and'");
      const v2 = this.parseNumberOrString();
      value = [v1, v2] as unknown as number;
    } else {
      value = this.parseNumberOrString();
    }

    // If cap keyword was present, wrap into a composite node
    if (capKeyword) {
      const sectorValue = this.parseSectorFromRest() as string;
      const sectorNode: NlNode = {
        kind: "literal",
        field: "sector",
        op: "above",
        value: sectorValue,
      };
      const filtered: NlNode = {
        kind: "literal",
        field: fieldToken.value as NlField,
        op: op.value as NlOperator,
        value,
      };
      return {
        kind: "composite",
        op: "and",
        children: [sectorNode, filtered],
      };
    }

    return {
      kind: "literal",
      field: fieldToken.value as NlField,
      op: op.value as NlOperator,
      value,
    };
  }

  private parseNumberOrString(): number | string {
    const t = this.peek();
    if (t.kind === TokenKind.Number) {
      this.advance();
      const raw = t.value.replace(/%/g, "").replace(/,/g, "");
      return parseFloat(raw);
    }
    if (t.kind === TokenKind.String || t.kind === TokenKind.Field) {
      return this.advance().value;
    }
    throw new ParseError(`Expected number or string, got '${t.raw}'`, t.start);
  }

  private parseSectorFromRest(): string {
    // Consume any remaining tokens as sector text (e.g., "banks", "it")
    const parts: string[] = [];
    while (this.peek().kind !== TokenKind.Eof && this.peek().kind !== TokenKind.BooleanOp) {
      parts.push(this.advance().value);
    }
    const s = parts.join(" ");
    const map: Record<string, string> = { it: "Information Technology", banks: "Financial Services" };
    return map[s.toLowerCase()] ?? s;
  }
}