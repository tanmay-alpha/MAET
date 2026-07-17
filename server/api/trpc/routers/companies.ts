/**
 * Companies tRPC Router
 * Company master data and fundamentals management
 */

import { createRouter, protectedProcedure, publicProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { companies, fundamentals } from "../../../db/schema";
import { desc, eq, ilike, and, sql, or } from "drizzle-orm";

export const companiesRouter = createRouter({
  // List companies with optional filters and pagination
  getCompanies: protectedProcedure
    .input(
      z.object({
        sector: z.string().optional(),
        exchange: z.string().optional(),
        isActive: z.boolean().optional(),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(200).default(50),
      }).optional()
    )
    .query(async ({ input }) => {
      const { sector, exchange, isActive, search, cursor, limit = 50 } = input ?? {};
      const finalLimit = Math.min(limit, 200);

      let query = db.select().from(companies);
      const conditions = [];

      if (sector) conditions.push(eq(companies.sector, sector));
      if (exchange) conditions.push(eq(companies.exchange, exchange));
      if (isActive !== undefined) conditions.push(eq(companies.isActive, isActive));
      if (search) {
        conditions.push(
          or(
            ilike(companies.symbol, `%${search}%`),
            ilike(companies.name, `%${search}%`)
          ) as any
        );
      }
      if (cursor) conditions.push(sql`${companies.symbol} > ${cursor}`);

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const rows = await query
        .orderBy(companies.symbol)
        .limit(finalLimit + 1);

      const hasMore = rows.length > finalLimit;
      const items = hasMore ? rows.slice(0, -1) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.symbol : null,
      };
    }),

  // Get a single company by symbol
  getCompany: publicProcedure
    .input(z.object({ symbol: z.string().min(1).max(20) }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(companies)
        .where(eq(companies.symbol, input.symbol.toUpperCase()))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Company not found: ${input.symbol}` });
      }
      return row;
    }),

  // Fuzzy search companies by symbol or name
  searchCompanies: publicProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const q = `%${input.query}%`;
      const rows = await db
        .select({
          symbol: companies.symbol,
          name: companies.name,
          exchange: companies.exchange,
          sector: companies.sector,
          industry: companies.industry,
        })
        .from(companies)
        .where(
          or(
            ilike(companies.symbol, q),
            ilike(companies.name, q)
          ) as any
        )
        .orderBy(companies.symbol)
        .limit(20);
      return rows;
    }),

  // Get fundamentals history for a company
  getFundamentals: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        limit: z.number().int().positive().max(40).default(20),
        periodType: z.enum(["quarterly", "annual"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const companyRows = await db
        .select()
        .from(companies)
        .where(eq(companies.symbol, input.symbol.toUpperCase()))
        .limit(1);

      const company = companyRows[0];
      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Company not found: ${input.symbol}` });
      }

      const fundRows = await db
        .select()
        .from(fundamentals)
        .where(
          input.periodType
            ? and(
                eq(fundamentals.companyId, company.id),
                eq(fundamentals.periodType, input.periodType)
              )
            : eq(fundamentals.companyId, company.id)
        )
        .orderBy(desc(fundamentals.periodDate))
        .limit(input.limit);

      return {
        company,
        fundamentals: fundRows,
      };
    }),

  // Upsert a company record (create or update)
  upsertCompany: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        name: z.string().min(1).max(200),
        exchange: z.string().min(2).max(5).default("NSE"),
        isin: z.string().max(12).optional(),
        sector: z.string().max(100).optional(),
        industry: z.string().max(200).optional(),
        marketCap: z.number().positive().optional(),
        peRatio: z.number().positive().optional(),
        pbRatio: z.number().positive().optional(),
        roe: z.number().optional(),
        dividendYield: z.number().min(0).optional(),
        eps: z.number().optional(),
        debtToEquity: z.number().min(0).optional(),
        faceValue: z.number().positive().optional(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const id = input.symbol.toUpperCase();
      const now = new Date();

      await db
        .insert(companies)
        .values({
          id,
          symbol: input.symbol.toUpperCase(),
          name: input.name,
          exchange: input.exchange,
          isin: input.isin,
          sector: input.sector,
          industry: input.industry,
          marketCap: input.marketCap?.toString(),
          peRatio: input.peRatio?.toString(),
          pbRatio: input.pbRatio?.toString(),
          roe: input.roe?.toString(),
          dividendYield: input.dividendYield?.toString(),
          eps: input.eps?.toString(),
          debtToEquity: input.debtToEquity?.toString(),
          faceValue: input.faceValue?.toString(),
          isActive: input.isActive,
          lastFundamentalsUpdate: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: companies.symbol,
          set: {
            name: input.name,
            exchange: input.exchange,
            isin: input.isin,
            sector: input.sector,
            industry: input.industry,
            marketCap: input.marketCap?.toString(),
            peRatio: input.peRatio?.toString(),
            pbRatio: input.pbRatio?.toString(),
            roe: input.roe?.toString(),
            dividendYield: input.dividendYield?.toString(),
            eps: input.eps?.toString(),
            debtToEquity: input.debtToEquity?.toString(),
            faceValue: input.faceValue?.toString(),
            isActive: input.isActive,
            updatedAt: now,
          },
        });

      return { success: true, symbol: input.symbol.toUpperCase() };
    }),

  // Sync fundamentals for a symbol from NSE
  syncFundamentals: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(20) }))
    .mutation(async ({ input }) => {
      const { getFundamentals: fetchNSEFundamentals } = await import(
        "../../../data/sources/nse"
      );

      let data;
      try {
        data = await fetchNSEFundamentals(input.symbol.toUpperCase());
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch fundamentals for ${input.symbol}: ${String(err)}`,
        });
      }

      const now = new Date();
      const id = input.symbol.toUpperCase();

      // Upsert company with latest fundamental data
      await db
        .insert(companies)
        .values({
          id,
          symbol: id,
          name: data.symbol,
          exchange: "NSE",
          sector: data.sector,
          industry: data.raw?.industry,
          marketCap: data.marketCap?.toString(),
          peRatio: data.pe?.toString(),
          pbRatio: data.pb?.toString(),
          roe: data.roe?.toString(),
          dividendYield: data.dividendYield?.toString(),
          lastFundamentalsUpdate: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: companies.symbol,
          set: {
            sector: data.sector,
            industry: data.raw?.industry,
            marketCap: data.marketCap?.toString(),
            peRatio: data.pe?.toString(),
            pbRatio: data.pb?.toString(),
            roe: data.roe?.toString(),
            dividendYield: data.dividendYield?.toString(),
            lastFundamentalsUpdate: now,
            updatedAt: now,
          },
        });

      return {
        success: true,
        symbol: input.symbol.toUpperCase(),
        fundamentals: {
          pe: data.pe,
          pb: data.pb,
          roe: data.roe,
          marketCap: data.marketCap,
          dividendYield: data.dividendYield,
          sector: data.sector,
        },
      };
    }),
});
