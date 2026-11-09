import { TRPCError } from "@trpc/server";
import { tradeThesisRepository } from "./repository";
import type { CreateThesisInput, LinkOrderToThesisInput } from "@shared/research/contracts";

export class TradeThesisService {
  async listTheses(userId: string) {
    return tradeThesisRepository.listTheses(userId);
  }

  async getThesisDetails(userId: string, thesisId: string) {
    const thesis = await tradeThesisRepository.getThesisById(userId, thesisId);
    if (!thesis) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Thesis not found" });
    }
    return thesis;
  }

  async createThesis(userId: string, input: CreateThesisInput) {
    if (input.stopPrice && input.targetPrice) {
      if (input.direction === "LONG" && input.stopPrice >= input.targetPrice) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "For LONG setup, stop price must be less than target price." });
      }
      if (input.direction === "SHORT" && input.stopPrice <= input.targetPrice) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "For SHORT setup, stop price must be greater than target price." });
      }
    }
    return tradeThesisRepository.createThesis(userId, input);
  }

  async captureSnapshot(userId: string, thesisId: string, quotePrice: number, quoteSource: string, quoteQuality: string, timeframe: string) {
    await this.getThesisDetails(userId, thesisId);
    return tradeThesisRepository.captureSnapshot(thesisId, quotePrice, quoteSource, quoteQuality, timeframe);
  }

  async linkOrder(userId: string, input: LinkOrderToThesisInput) {
    await this.getThesisDetails(userId, input.thesisId);
    return tradeThesisRepository.linkOrder(userId, input.thesisId, input);
  }
}

export const tradeThesisService = new TradeThesisService();
