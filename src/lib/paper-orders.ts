import { getPositionCloseSide } from "@shared/domain/paper-trading/margin";
import type { PaperOrderDraft } from "@/hooks/use-paper-account";
import type { PaperPositionRow } from "../../server/modules/paper-trading/contracts";

/** Market order that flattens `position` on the exchange where it is held. */
export function buildClosePositionOrder(
  position: Pick<PaperPositionRow, "symbol" | "exchange" | "side" | "totalShares">
): PaperOrderDraft {
  const { exchange } = position;
  if (exchange !== "NSE" && exchange !== "BSE") {
    throw new Error(`Cannot close ${position.symbol}: unsupported exchange ${exchange}.`);
  }
  return {
    type: "MARKET",
    symbol: position.symbol,
    exchange,
    side: getPositionCloseSide(position),
    quantity: Math.abs(position.totalShares),
  };
}
