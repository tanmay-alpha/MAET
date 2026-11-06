/**
 * Only NSE is streamed (interest-subscriptions STREAMED_EXCHANGES, Angel One exchangeType 1):
 * a BSE resting order could never fill from a tick and a BSE MARKET order has no live quote,
 * so new BSE paper orders are refused by the service and not offered by the order tickets.
 */
export const BSE_UNSUPPORTED_MESSAGE = "BSE paper orders are not supported: MAET has no live BSE feed";
