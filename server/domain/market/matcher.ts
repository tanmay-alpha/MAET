import type { Tick } from "@shared/types";
import type { MatchingReceipt } from "../../modules/paper-trading/contracts";
import { paperTradingTickProcessor } from "../../modules/paper-trading/tick-processor";

export type { MatchingReceipt };

export async function onTick(rawTick: Tick): Promise<MatchingReceipt[]> {
  return paperTradingTickProcessor.processTick(rawTick);
}
