/**
 * Natural-language screener compiler.
 *
 * Transforms the AST produced by the parser into the validated screener
 * criteria format used by the existing screener engine.
 *
 * No SQL generation. No LLM dependency.
 */

import type { NlNode, NlLiteralNode, NlCompositeNode } from "@shared/screener/ast";
import { CriterionLeafSchema, CriterionSchema } from "@shared/types/screener";
import type { Criterion, CriterionLeaf } from "@shared/types/screener";
import { z } from "zod";
import { FIELD_MAPPINGS, KNOWN_OPERATORS } from "@shared/screener/schema";

type FieldMapping = (typeof FIELD_MAPPINGS)[number];

export interface CompileResult {
  success: boolean;
  criteria: Criterion | null;
  errors: string[];
  preview: CompilePreview | null;
}

export interface CompilePreview {
  filters: Array<{ field: string; operator: string; value: unknown }>;
  explanation: string;
}

const NL_TO_SCREENER_OP: Record<string, CriterionLeaf["op"]> = {
  above: "gt",
  below: "lt",
  between: "between",
  crosses_above: "gte",
  crosses_below: "lte",
  within: "lte",
};

export class ScreenerCompiler {
  compile(node: NlNode): CompileResult {
    try {
      const criteria = this.transformNode(node);
      // Validate against existing screener schema
      CriterionSchema.parse(criteria);
      const preview = this.buildPreview(node);
      return { success: true, criteria, errors: [], preview };
    } catch (err) {
      const msg = err instanceof z.ZodError ? err.errors.map((e) => e.message).join("; ") : String(err);
      return { success: false, criteria: null, errors: [msg], preview: null };
    }
  }

  private transformNode(node: NlNode): Criterion {
    if (node.kind === "literal") {
      const mapping = FIELD_MAPPINGS.find((m: FieldMapping) => m.nlField === node.field);
      if (!mapping) {
        throw new Error(`Unsupported field: ${node.field}`);
      }
      const op = NL_TO_SCREENER_OP[node.op] ?? "gt";
      const value = typeof node.value === "string" ? this.parseValue(node.value, mapping) : node.value;
      const leaf: CriterionLeaf = {
        field: mapping.screenerField as CriterionLeaf["field"],
        op: op as CriterionLeaf["op"],
        value,
        ...(mapping.unit === "%" ? { unit: "pct" } : {}),
      };
      return leaf;
    }
    const children = (node as NlCompositeNode).children.map((c: NlNode) => this.transformNode(c));
    return { op: (node as NlCompositeNode).op === "and" ? "AND" : "OR", children };
  }

  private parseValue(value: string, mapping: FieldMapping): number | string {
    if (mapping.parser) return mapping.parser(value);
    return value;
  }

  private buildPreview(node: NlNode): CompilePreview {
    const filters: Array<{ field: string; operator: string; value: unknown }> = [];
    this.collectFilters(node, filters);
    return {
      filters,
      explanation: this.toSentence(node),
    };
  }

  private collectFilters(node: NlNode, out: Array<{ field: string; operator: string; value: unknown }>): void {
    if (node.kind === "literal") {
      const mapping = FIELD_MAPPINGS.find((m: FieldMapping) => m.nlField === node.field);
      const op = NL_TO_SCREENER_OP[node.op] ?? node.op;
      out.push({ field: mapping?.screenerField ?? node.field, operator: op, value: node.value });
    } else {
      for (const child of (node as NlCompositeNode).children) {
        this.collectFilters(child, out);
      }
    }
  }

  private toSentence(node: NlNode): string {
    if (node.kind === "literal") {
      const mapping = FIELD_MAPPINGS.find((m: FieldMapping) => m.nlField === node.field);
      const label = mapping?.screenerField ?? node.field;
      return `${label} ${node.op} ${node.value}`;
    }
    const children = (node as NlCompositeNode).children.map((c: NlNode) => this.toSentence(c));
    return children.join(` ${(node as NlCompositeNode).op} `);
  }
}