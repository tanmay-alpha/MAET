/**
 * Describes how fresh the displayed quotes are. A connected stream is not enough to
 * call quotes live: outside market hours, or on the delayed provider, it carries
 * delayed or last-close prices.
 */
export function quoteFeedLabel({
  isError,
  delayed,
  marketPhase,
}: {
  isError: boolean;
  delayed: boolean;
  marketPhase: string | undefined;
}): string {
  if (isError) return "Quote service unavailable";
  if (!delayed) return "Live quotes";
  if (marketPhase === undefined || marketPhase === "OPEN") return "Delayed quotes";
  if (marketPhase === "PRE_OPEN") return "Pre-open · delayed quotes";
  return "Market closed · last available quotes";
}
