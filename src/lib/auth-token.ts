/**
 * The browser's Supabase session: where it is stored, how it is refreshed, and who is told
 * when it changes. The session lives in localStorage in the shape supabase-js persists
 * (`sb-<project>-auth-token`: access_token, refresh_token, expires_at, user); the legacy
 * `supabase.auth.token` key with a nested `currentSession` is still read.
 */

interface StoredUser {
  id?: string;
  email?: string;
}

interface SupabaseSessionData {
  currentSession?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    expiresAt?: number;
    user?: StoredUser;
  };
  expiresAt?: number;
  expires_at?: number;
  access_token?: string;
  refresh_token?: string;
  user?: StoredUser;
}

/** A session as Supabase Auth (GoTrue) returns it from /token, /signup or a magic-link redirect. */
export interface AuthSessionPayload {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: unknown;
}

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

/**
 * Both values are public by design (the anon key only grants what RLS allows) and must be
 * VITE_-prefixed so Vite inlines them into the browser bundle; process.env is empty there.
 * Read on each call so tests can set them. Null when either is missing: sign-in is off.
 */
export function supabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && anonKey ? { url: url.replace(/\/+$/, ""), anonKey } : null;
}

/** After a refresh fails for a transient reason (network, Supabase 5xx), wait this long before trying again. */
const TRANSIENT_REFRESH_BACKOFF_MS = 30_000;

type RefreshOutcome =
  | { kind: "refreshed"; accessToken: string }
  /** Supabase refused the refresh token (revoked, reused, user deleted): the session is gone. */
  | { kind: "rejected" }
  /** Supabase could not be asked (offline, outage, not configured): the session may still recover. */
  | { kind: "unavailable" };

let refreshPromise: Promise<RefreshOutcome> | null = null;
let transientFailure: { refreshToken: string; until: number } | null = null;
const sameTabListeners = new Set<() => void>();

/** localStorage keys that hold a Supabase session ("supabase.auth.token" or "sb-<project>-auth-token"). */
function isSupabaseSessionKey(key: string): boolean {
  return key === "supabase.auth.token" || key.endsWith("-auth-token");
}

/**
 * Calls `onChange` when the session is stored, refreshed or cleared: by this tab (sign-in,
 * sign-out, a rejected refresh) or by another one (`storage` events only fire for writes
 * made by other documents).
 */
export function watchStoredSession(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // A null key means another tab called localStorage.clear().
    if (event.key === null || isSupabaseSessionKey(event.key)) onChange();
  };
  window.addEventListener("storage", onStorage);
  sameTabListeners.add(onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    sameTabListeners.delete(onChange);
  };
}

function notifySessionChange(): void {
  for (const listener of [...sameTabListeners]) listener();
}

function getStoredSession(): { rawKey: string; data: SupabaseSessionData } | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  // Primary key used by application and certification harnesses
  const primaryRaw = window.localStorage.getItem("supabase.auth.token");
  if (primaryRaw) {
    try {
      const parsed = JSON.parse(primaryRaw);
      return { rawKey: "supabase.auth.token", data: parsed };
    } catch {
      // Invalid JSON
    }
  }

  // Check standard Supabase project storage keys if primary key is not set
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && isSupabaseSessionKey(key)) {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          return { rawKey: key, data: parsed };
        } catch {
          // Ignore
        }
      }
    }
  }

  return null;
}

function storedAccessToken(data: SupabaseSessionData): string | undefined {
  return data.currentSession?.access_token || data.access_token;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expiresAtOf(payload: Pick<AuthSessionPayload, "expires_at" | "expires_in">): number {
  return payload.expires_at ?? nowSeconds() + (payload.expires_in ?? 3600);
}

/** The key supabase-js uses for a project: "sb-<first label of the project host>-auth-token". */
function sessionKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function removeStoredSessions(): void {
  const storage = window.localStorage;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key !== null && isSupabaseSessionKey(key)) storage.removeItem(key);
  }
}

/** Persists a session Supabase just issued (sign-in, sign-up, magic link), replacing any other. */
export function storeSession(session: AuthSessionPayload): void {
  const config = supabaseAuthConfig();
  if (!config) throw new Error("Sign-in is not configured");
  removeStoredSessions();
  window.localStorage.setItem(
    sessionKeyFor(config.url),
    JSON.stringify({ ...session, expires_at: expiresAtOf(session) }),
  );
  transientFailure = null;
  notifySessionChange();
}

/** Forgets the session in this browser and tells every watcher. */
export function clearStoredSession(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  removeStoredSessions();
  notifySessionChange();
}

async function requestRefresh(
  rawKey: string,
  refreshToken: string,
  sessionData: SupabaseSessionData,
): Promise<RefreshOutcome> {
  // Supabase rejects refresh requests without the project's anon key.
  const config = supabaseAuthConfig();
  if (!config) return { kind: "unavailable" };
  let res: Response;
  try {
    res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return { kind: "unavailable" };
  }

  // GoTrue answers 400 (invalid_grant / refresh_token_not_found / already used) or 401
  // when the refresh token can never work again. Anything else may pass.
  if (res.status === 400 || res.status === 401) return { kind: "rejected" };
  if (!res.ok) return { kind: "unavailable" };

  const refreshed = (await res.json().catch(() => null)) as AuthSessionPayload | null;
  if (!refreshed?.access_token) return { kind: "unavailable" };

  const expiresAt = expiresAtOf(refreshed);
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
  const user = refreshed.user ? { user: refreshed.user } : {};
  // Write back in the shape it was read, so the next read finds the new tokens first.
  const updated: SupabaseSessionData = sessionData.currentSession
    ? {
        ...sessionData,
        currentSession: {
          ...sessionData.currentSession,
          access_token: refreshed.access_token,
          refresh_token: nextRefreshToken,
          expires_at: expiresAt,
          expiresAt,
          ...user,
        },
        expiresAt,
      }
    : {
        ...sessionData,
        ...refreshed,
        refresh_token: nextRefreshToken,
        expires_at: expiresAt,
        ...user,
      };
  window.localStorage.setItem(rawKey, JSON.stringify(updated));
  return { kind: "refreshed", accessToken: refreshed.access_token };
}

/**
 * One refresh at a time. A rejected refresh token clears the session (it can never work
 * again); a transient failure keeps it but backs off instead of retrying on every request.
 */
function refreshStoredSession(): Promise<RefreshOutcome> {
  if (refreshPromise) return refreshPromise;
  const stored = getStoredSession();
  const refreshToken = stored && (stored.data.currentSession?.refresh_token || stored.data.refresh_token);
  if (!stored || !refreshToken) return Promise.resolve({ kind: "unavailable" });
  if (transientFailure?.refreshToken === refreshToken && Date.now() < transientFailure.until) {
    return Promise.resolve({ kind: "unavailable" });
  }

  refreshPromise = requestRefresh(stored.rawKey, refreshToken, stored.data)
    .then((outcome) => {
      transientFailure =
        outcome.kind === "unavailable" ? { refreshToken, until: Date.now() + TRANSIENT_REFRESH_BACKOFF_MS } : null;
      if (outcome.kind === "rejected") clearStoredSession();
      else if (outcome.kind === "refreshed") notifySessionChange();
      return outcome;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/**
 * Whether this browser holds a Supabase session (an access token, possibly expired but
 * refreshable). Synchronous, for gating requests that only make sense when signed in.
 */
export function hasStoredSession(): boolean {
  const data = getStoredSession()?.data;
  return Boolean(data && storedAccessToken(data));
}

/** The signed-in user's email, as Supabase returned it with the session; null when signed out. */
export function getStoredUserEmail(): string | null {
  const data = getStoredSession()?.data;
  if (!data || !storedAccessToken(data)) return null;
  return data.user?.email ?? data.currentSession?.user?.email ?? null;
}

/** The stored access token as is, expired or not (for /logout). */
export function getStoredAccessToken(): string | null {
  const data = getStoredSession()?.data;
  return (data && storedAccessToken(data)) || null;
}

export async function getCurrentAccessToken(): Promise<string | null> {
  const stored = getStoredSession();
  if (!stored) {
    return null;
  }

  const { data } = stored;
  const accessToken = storedAccessToken(data);
  if (!accessToken) {
    return null;
  }

  const rawExpiresAt =
    data.currentSession?.expires_at ?? data.currentSession?.expiresAt ?? data.expires_at ?? data.expiresAt;
  const isExpired = typeof rawExpiresAt === "number" && rawExpiresAt <= nowSeconds() + 10;
  if (!isExpired) {
    return accessToken;
  }

  const outcome = await refreshStoredSession();
  return outcome.kind === "refreshed" ? outcome.accessToken : null;
}

/**
 * The server answered 401 to `rejectedToken`: get a token worth one more try. If another
 * request already replaced it, that one is used; otherwise the session is refreshed even
 * though its clock says it is still valid. Null when there is nothing better to send.
 */
export async function refreshAfterRejection(rejectedToken: string): Promise<string | null> {
  const stored = getStoredSession();
  const current = stored ? storedAccessToken(stored.data) : undefined;
  if (!current) return null;
  if (current !== rejectedToken) return getCurrentAccessToken();
  const outcome = await refreshStoredSession();
  return outcome.kind === "refreshed" ? outcome.accessToken : null;
}
