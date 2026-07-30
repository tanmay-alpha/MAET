import { createRouter, protectedProcedure, publicProcedure } from "../core";
import { z } from "zod";

export const screenerDslRouter = createRouter({
  preview: publicProcedure
    .input(z.object({ natural: z.string().min(1).max(500) }).strict())
    .query(async ({ input }) => {
      // Placeholder: returns compiled preview
      return { natural: input.natural, compiled: { description: "Parser placeholder" } };
    }),
  suggest: publicProcedure
    .input(z.object({ natural: z.string().min(1).max(500) }).strict())
    .query(async ({ input }) => {
      return { suggestions: [{ description: "Natural language parser stub", fields: [] }] };
    }),
});