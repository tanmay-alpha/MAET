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

    let value: number | string | [number, number];
    if (op.value === "between") {
      const v1 = this.parseNumberOrString();
      const andToken = this.peek();
      if (
        (andToken.kind === TokenKind.BooleanOp && andToken.value === "and") ||
        (andToken.kind === TokenKind.String && andToken.value === "and")
      ) {
        this.advance();
      } else {
        throw new ParseError("Expected 'and' between range bounds", andToken.start);
      }
      const v2 = this.parseNumberOrString();
      const n1 = typeof v1 === "number" ? v1 : Number(v1);
      const n2 = typeof v2 === "number" ? v2 : Number(v2);
      if (!Number.isFinite(n1) || !Number.isFinite(n2)) {
        throw new ParseError("Range bounds must be valid finite numbers", andToken.start);
      }
      value = [n1, n2];
    } else {
      value = this.parseNumberOrString();
    }

    // If cap keyword was present, wrap into a composite node with market_cap predicate
    if (capKeyword) {
      const normCap = capKeyword.replace(/\s+/g, "").toLowerCase();
      let capNode: NlNode;
      if (normCap === "largecap") {
        capNode = { kind: "literal", field: "market_cap", op: "above", value: 50000 };
      } else if (normCap === "midcap") {
        capNode = { kind: "literal", field: "market_cap", op: "between", value: [15000, 50000] };
      } else {
        capNode = { kind: "literal", field: "market_cap", op: "below", value: 15000 };
      }
      const filtered: NlNode = {
        kind: "literal",
        field: fieldToken.value as NlField,
        op: op.value as NlOperator,
        value,
      };
      return {
        kind: "composite",
        op: "and",
        children: [capNode, filtered],
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