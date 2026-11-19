/**
 * Email + password accounts against Supabase Auth (GoTrue) over its REST API, with the
 * project's public anon key. A successful sign-in is stored exactly where and how
 * supabase-js would store it (see auth-token.ts), so the tRPC and SSE clients pick it up
 * unchanged.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  clearStoredSession,
  storeSession,
  storedAccessToken,
  storedSessionIdentity,
  supabaseAuthConfig,
  watchStoredSession,
  type GoTrueSession,
} from "./auth-token";

export const SIGN_IN_NOT_CONFIGURED_MESSAGE = "Sign-in is not configured on this deployment.";
const UNREACHABLE_MESSAGE = "Could not reach the sign-in service. Check your connection and try again.";
const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a minute and try again.";

/** GoTrue `error_code`s with a clearer line for the person at the form. */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed: "Confirm your email address first: open the link in the email we sent you.",
  user_already_exists: "An account with this email already exists. Sign in instead.",
  email_exists: "An account with this email already exists. Sign in instead.",
  over_request_rate_limit: RATE_LIMITED_MESSAGE,
  over_email_send_rate_limit: RATE_LIMITED_MESSAGE,
  signup_disabled: "New accounts cannot be created on this deployment.",
  email_provider_disabled: "Email sign-in is disabled on this deployment.",
};

/**
 * The line to show for a failed GoTrue call. Current GoTrue answers
 * `{ code, error_code, msg }`; older versions `{ error, error_description }`.
 */
export function goTrueErrorMessage(status: number, body: unknown): string {
  const field = (key: string) => {
    const value = typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const code = field("error_code");
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
  const message = field("msg") ?? field("error_description") ?? field("message");
  if (message === "Invalid login credentials") return ERROR_CODE_MESSAGES.invalid_credentials;
  if (message === "Email not confirmed") return ERROR_CODE_MESSAGES.email_not_confirmed;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (status >= 500) return `The sign-in service is unavailable (HTTP ${status}). Try again later.`;
  return message ?? `Sign-in failed (HTTP ${status}).`;
}

function isSession(body: unknown): body is GoTrueSession {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof Reflect.get(body, "access_token") === "string" &&
    typeof Reflect.get(body, "refresh_token") === "string"
  );
}

type GoTrueResponse = { ok: true; body: unknown } | { ok: false; message: string };

async function postGoTrue(path: string, body: unknown): Promise<GoTrueResponse> {
  const config = supabaseAuthConfig();
  if (!config) return { ok: false, message: SIGN_IN_NOT_CONFIGURED_MESSAGE };
  let res: Response;
  try {
    res = await fetch(`${config.url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: UNREACHABLE_MESSAGE };
  }
  const json: unknown = await res.json().catch(() => null);
  return res.ok ? { ok: true, body: json } : { ok: false, message: goTrueErrorMessage(res.status, json) };
}

export type SignInResult = { ok: true } | { ok: false; message: string };

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const response = await postGoTrue("token?grant_type=password", { email: email.trim(), password });
  if (!response.ok) return response;
  if (!isSession(response.body)) return { ok: false, message: "The sign-in service sent an unexpected response." };
  storeSession(response.body);
  return { ok: true };
}

export type SignUpResult =
  | { status: "signed-in" }
  /** The project requires email confirmation: GoTrue created the user and mailed a link. */
  | { status: "confirmation-required"; email: string }
  | { status: "error"; message: string };

export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  const address = email.trim();
  const response = await postGoTrue("signup", { email: address, password });
  if (!response.ok) return { status: "error", message: response.message };
  // Auto-confirming projects answer with a session; confirming ones with the bare user.
  if (isSession(response.body)) {
    storeSession(response.body);
    return { status: "signed-in" };
  }
  return { status: "confirmation-required", email: address };
}

/**
 * Forgets the session in this browser immediately, then asks GoTrue to revoke its refresh
 * token. The local sign-out does not wait for (or depend on) the network.
 */
export async function signOut(): Promise<void> {
  const accessToken = storedAccessToken();
  clearStoredSession();
  const config = supabaseAuthConfig();
  if (!config || !accessToken) return;
  try {
    await fetch(`${config.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Offline: the access token still expires on its own; nothing is stored locally any more.
  }
}

/** /login, returning to `path` (a same-origin path) after signing in. */
export function loginHref(path: string): string {
  return `/login?redirect=${encodeURIComponent(path)}`;
}

/**
 * Where to go after signing in: a same-origin path from `?redirect=`, never another origin
 * ("//evil.example", "/\\evil.example" or an absolute URL would leave the app).
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  if (/\p{Cc}/u.test(value) || value === "/login" || value.startsWith("/login?") || value.startsWith("/login#")) {
    return fallback;
  }
  return value;
}

/**
 * Drops every cached query when the signed-in user changes — sign-out, sign-in, or another
 * account in another tab — so one account's data never renders for the next. Token refreshes
 * keep the identity, and the cache. Returns the unsubscribe function.
 */
export function clearQueriesOnSessionChange(queryClient: Pick<QueryClient, "clear">): () => void {
  let identity = storedSessionIdentity();
  return watchStoredSession(() => {
    const next = storedSessionIdentity();
    if (next === identity) return;
    identity = next;
    queryClient.clear();
  });
}
