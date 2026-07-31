import { createRouter, publicProcedure } from "../core";
import { z } from "zod";
import { tokenize } from "../../../modules/screener-dsl/tokenizer";
import { ScreenerDslParser } from "../../../modules/screener-dsl/parser";
import { ScreenerCompiler } from "../../../modules/screener-dsl/compiler";

export const screenerDslRouter = createRouter({
  parseAndCompile: publicProcedure
    .input(z.object({ natural: z.string().min(1).max(500) }).strict())
    .mutation(async ({ input }) => {
      try {
        const parser = new ScreenerDslParser();
        const parseRes = parser.parse(input.natural);
        if (!parseRes.success || !parseRes.ast) {
          return {
            natural: input.natural,
            tokens: [],
            ast: null,
            criteria: null,
            preview: null,
            errors: [parseRes.error?.message ?? "Parse failure"],
            success: false,
          };
        }

        const compiler = new ScreenerCompiler();
        const compileRes = compiler.compile(parseRes.ast);

        return {
          natural: input.natural,
          tokens: tokenize(input.natural),
          ast: parseRes.ast,
          criteria: compileRes.criteria,
          preview: compileRes.preview,
          errors: compileRes.errors,
          success: compileRes.success,
        };
      } catch (err: any) {
        return {
          natural: input.natural,
          tokens: [],
          ast: null,
          criteria: null,
          preview: null,
          errors: [err.message ?? "Parsing failure"],
          success: false,
        };
      }
    }),

  preview: publicProcedure
    .input(z.object({ natural: z.string().min(1).max(500) }).strict())
    .query(async ({ input }) => {
      const parser = new ScreenerDslParser();
      const parseRes = parser.parse(input.natural);
      if (!parseRes.success || !parseRes.ast) {
        return { natural: input.natural, compiled: null, criteria: null };
      }
      const compiler = new ScreenerCompiler();
      const compileRes = compiler.compile(parseRes.ast);
      return { natural: input.natural, compiled: compileRes.preview, criteria: compileRes.criteria };
    }),

  suggest: publicProcedure
    .input(z.object({ natural: z.string().min(1).max(500) }).strict())
    .query(async () => {
      return {
        suggestions: [
          { description: "Market cap above 10000 Cr", fields: ["marketCap"] },
          { description: "PE below 20 and ROE above 15%", fields: ["peRatio", "roe"] },
          { description: "RSI below 30 and volume above 100000", fields: ["rsi", "volume"] },
        ],
      };
    }),
});