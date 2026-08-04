import { tradeThesisRepository } from "./repository";
import type { CreateThesisInput, LinkOrderToThesisInput } from "@shared/research/contracts";

export class TradeThesisService {
  async listTheses(userId: string) {
    return tradeThesisRepository.listTheses(userId);
  }

  async getThesisDetails(userId: string, thesisId: string) {
    const thesis = await tradeThesisRepository.getThesisById(userId, thesisId);
    if (!thesis) {
      throw new Error("Thesis not found or unauthorized.");
    }
    return thesis;
  }

  async createThesis(userId: string, input: CreateThesisInput) {
    if (input.stopPrice && input.targetPrice) {
      if (input.direction === "LONG" && input.stopPrice >= input.targetPrice) {
        throw new Error("For LONG setup, stop price must be less than target price.");
      }
      if (input.direction === "SHORT" && input.stopPrice <= input.targetPrice) {
        throw new Error("For SHORT setup, stop price must be greater than target price.");
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
    return tradeThesisRepository.linkOrder(input.thesisId, input);
  }
}

export const tradeThesisService = new TradeThesisService();
