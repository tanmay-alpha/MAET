/** Shown wherever a paper-trading action needs an account the visitor isn't signed in to. */
export const SIGN_IN_REQUIRED_MESSAGE = "Paper trading requires a signed-in account.";

/** The browser holds a session the server rejected (401): expired or revoked. */
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again.";

/** Signed in, but the server failed to load the account (5xx, database down, network). */
export const PAPER_ACCOUNT_UNAVAILABLE_MESSAGE = "Paper account unavailable: the server could not load it.";
