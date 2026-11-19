/**
 * The URL fragment Supabase Auth redirects to after an email link (sign-up confirmation,
 * magic link, invite, email change, recovery) in the implicit flow:
 *   #access_token=…&refresh_token=…&expires_in=3600&expires_at=…&token_type=bearer&type=signup
 * or, when the link is invalid or expired:
 *   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid…
 */

export type AuthFragment =
  | {
      kind: "session";
      accessToken: string;
      refreshToken: string;
      /** Seconds since the epoch; derived from expires_in when expires_at is absent. */
      expiresAt: number | undefined;
      expiresIn: number | undefined;
      /** What the link was for (signup, magiclink, recovery, invite, email_change, …). */
      type: string | null;
    }
  | { kind: "error"; code: string | null; message: string };

const LINK_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: "This email link is invalid or has expired. Sign in, or sign up again to get a new link.",
};

function positiveNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Reads an auth redirect fragment; null when the fragment carries no auth parameters (an
 * ordinary in-page anchor), so it is left alone. A fragment with only one of the two tokens
 * is reported as an error: it must still be stripped from the URL.
 */
export function parseAuthFragment(hash: string): AuthFragment | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);

  const error = params.get("error") || params.get("error_code");
  if (error) {
    const code = params.get("error_code");
    const description = params.get("error_description")?.trim();
    return {
      kind: "error",
      code,
      message: (code && LINK_ERROR_MESSAGES[code]) || description || `Sign-in link failed (${error}).`,
    };
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken && !refreshToken) return null;
  if (!accessToken || !refreshToken) {
    return { kind: "error", code: null, message: "The sign-in link was incomplete. Sign in with your email and password." };
  }
  const expiresIn = positiveNumber(params.get("expires_in"));
  const expiresAt =
    positiveNumber(params.get("expires_at")) ?? (expiresIn === undefined ? undefined : Math.floor(Date.now() / 1000) + expiresIn);
  return { kind: "session", accessToken, refreshToken, expiresAt, expiresIn, type: params.get("type") };
}
