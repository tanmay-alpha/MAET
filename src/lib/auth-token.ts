/**
 * The browser's Supabase session: where it is stored, who it belongs to, and a current
 * access token for API calls (refreshed through GoTrue when it has expired).
 *
 * Sessions live in localStorage under "sb-<project-ref>-auth-token" in the shape
 * supabase-js v2 persists (access_token, refresh_token, expires_at, user at the top level).
 * The legacy "supabase.auth.token" key and its { currentSession } shape are still read.
 */

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

/**
 * The Supabase project sign-in talks to, or null when this build was made without one.
 * Both values are public by design (the anon key only grants what RLS allows) and must be
 * VITE_-prefixed so Vite inlines them into the bundle; process.env is empty in the browser.
 * There is deliberately no fallback project: without them sign-in is "not configured".
 */
export function supabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url: url.replace(/\/+$/, ""), anonKey } : null;
}

/** A GoTrue session response (password grant, sign-up, refresh). */
export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string } & Record<string, unknown>;
}

interface StoredSessionFields {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expiresAt?: number;
  user?: { id?: string; email?: string };
}

interface StoredSessionData extends StoredSessionFields {
  currentSession?: StoredSessionFields;
}

const LEGACY_SESSION_KEY = "supabase.auth.token";
/** Set (in sessionStorage) when GoTrue refused to refresh the session, so the UI can say why. */
const SESSION_EXPIRED_FLAG = "maet.auth.sessionExpired";

/** The refresh request in flight and the refresh token it was sent with. */
let inFlightRefresh: { refreshToken: string; promise: Promise<string | null> } | null = null;
/**
 * Bumped by every sign-in and sign-out in this tab. A refresh started under one generation
 * must not touch storage once another has begun, even if the new session happens to carry
 * the same refresh token (e.g. the same session restored after sign-out).
 */
let sessionGeneration = 0;
const sameTabListeners = new Set<() => void>();

/** localStorage keys that hold a Supabase session ("supabase.auth.token" or "sb-<project>-auth-token"). */
function isSupabaseSessionKey(key: string): boolean {
  return key === LEGACY_SESSION_KEY || key.endsWith("-auth-token");
}

function localStore(): Storage | null {
  return typeof window === "undefined" ? null : (window.localStorage ?? null);
}

function notifySessionChange(): void {
  for (const listener of [...sameTabListeners]) listener();
}

/**
 * Calls `onChange` when the stored session changes: sign-in, sign-out or refresh in this
 * tab, or in another one (`storage` events only fire for writes made by other documents).
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

function getStoredSession(): { rawKey: string; data: StoredSessionData } | null {
  const storage = localStore();
  if (!storage) return null;
  const parse = (key: string) => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const data: unknown = JSON.parse(raw);
      return typeof data === "object" && data !== null ? { rawKey: key, data: data as StoredSessionData } : null;
    } catch {
      return null;
    }
  };

  // Primary key used by older builds and certification harnesses.
  const legacy = parse(LEGACY_SESSION_KEY);
  if (legacy) return legacy;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isSupabaseSessionKey(key)) {
      const found = parse(key);
      if (found) return found;
    }
  }
  return null;
}

/** The fields of a stored session, whichever shape (v2 top level or legacy currentSession) holds them. */
function sessionFields(data: StoredSessionData): StoredSessionFields {
  return data.currentSession?.access_token ? data.currentSession : data;
}

function expiresAtOf(session: Pick<GoTrueSession, "expires_at" | "expires_in">): number {
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at ?? nowSec + (session.expires_in ?? 3600);
}

/**
 * Persists a fresh session (sign-in or sign-up) as supabase-js v2 would, replacing any other
 * stored session so the readers above cannot pick a stale one, and tells every watcher.
 */
export function storeSession(session: GoTrueSession): void {
  const storage = localStore();
  const config = supabaseAuthConfig();
  if (!storage || !config) return;
  sessionGeneration++;
  for (const key of sessionKeys(storage)) storage.removeItem(key);
  const projectRef = new URL(config.url).hostname.split(".")[0];
  storage.setItem(
    `sb-${projectRef}-auth-token`,
    JSON.stringify({ ...session, expires_at: expiresAtOf(session) }),
  );
  window.sessionStorage?.removeItem(SESSION_EXPIRED_FLAG);
  notifySessionChange();
}

function sessionKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null && isSupabaseSessionKey(key),
  );
}

/**
 * Forgets every stored session in this browser and tells every watcher. `reason: "expired"`
 * records that the session ended because GoTrue refused to refresh it; without it (an
 * explicit sign-out) any such earlier record is dropped.
 */
export function clearStoredSession(reason?: "expired"): void {
  const storage = localStore();
  if (!storage) return;
  sessionGeneration++;
  for (const key of sessionKeys(storage)) storage.removeItem(key);
  if (reason === "expired") window.sessionStorage?.setItem(SESSION_EXPIRED_FLAG, "1");
  else window.sessionStorage?.removeItem(SESSION_EXPIRED_FLAG);
  notifySessionChange();
}

/** Whether the last session ended because it could no longer be refreshed (this tab only). */
export function sessionEndedByExpiry(): boolean {
  return typeof window !== "undefined" && window.sessionStorage?.getItem(SESSION_EXPIRED_FLAG) === "1";
}

/**
 * Whether the session a refresh started from is still the one stored: same tab generation,
 * same storage key, same refresh token (another tab signing out, signing in or rotating the
 * token changes the stored refresh token).
 */
function isStillStored(started: { generation: number; rawKey: string; refreshToken: string }): boolean {
  if (started.generation !== sessionGeneration) return false;
  const stored = getStoredSession();
  return stored?.rawKey === started.rawKey && sessionFields(stored.data).refresh_token === started.refreshToken;
}

/**
 * Exchanges the refresh token for a new session and stores it. The result — written back,
 * or the session cleared on a 400/401 — applies only if the session it started from is still
 * stored when GoTrue answers; after a sign-out or another user's sign-in it is discarded and
 * no token is returned, so the stale session never comes back or ends the new one.
 */
async function refreshAccessToken(
  rawKey: string,
  refreshToken: string,
  sessionData: StoredSessionData,
): Promise<string | null> {
  // Supabase rejects refresh requests without the project's anon key.
  const config = supabaseAuthConfig();
  if (!config) return null;
  const started = { generation: sessionGeneration, rawKey, refreshToken };
  let res: Response;
  try {
    res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // Offline: keep the session; a later call can still refresh it.
    return null;
  }

  if (!res.ok) {
    // 400/401: the refresh token was revoked, reused or has expired. The session is over.
    if ((res.status === 400 || res.status === 401) && isStillStored(started)) clearStoredSession("expired");
    return null;
  }

  const refreshed = (await res.json().catch(() => null)) as Partial<GoTrueSession> | null;
  if (!refreshed?.access_token) return null;
  if (!isStillStored(started)) return null;

  const updated: StoredSessionFields = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? refreshToken,
    expires_at: expiresAtOf(refreshed),
    ...(refreshed.user ? { user: refreshed.user } : {}),
  };
  // Write back in the shape that was stored, so its other fields survive.
  const next: StoredSessionData = sessionData.currentSession?.access_token
    ? { ...sessionData, currentSession: { ...sessionData.currentSession, ...updated }, expiresAt: updated.expires_at }
    : { ...sessionData, ...updated };
  localStore()?.setItem(rawKey, JSON.stringify(next));
  notifySessionChange();
  return refreshed.access_token;
}

/**
 * Whether this browser holds a Supabase session (an access token, possibly expired but
 * refreshable). Synchronous, for gating requests that only make sense when signed in.
 */
export function hasStoredSession(): boolean {
  const data = getStoredSession()?.data;
  return Boolean(data && sessionFields(data).access_token);
}

/** The stored access token as is (no expiry check, no refresh). */
export function storedAccessToken(): string | null {
  const data = getStoredSession()?.data;
  return (data && sessionFields(data).access_token) || null;
}

/** The signed-in user's email, when the stored session carries it. */
export function storedSessionEmail(): string | null {
  const data = getStoredSession()?.data;
  return (data && sessionFields(data).user?.email) || null;
}

/**
 * Who the stored session belongs to: the user id, or the JWT subject when the session has
 * no user object; null when signed out. Token refreshes keep it unchanged.
 */
export function storedSessionIdentity(): string | null {
  const data = getStoredSession()?.data;
  if (!data) return null;
  const fields = sessionFields(data);
  if (!fields.access_token) return null;
  if (fields.user?.id) return fields.user.id;
  try {
    const payload = fields.access_token.split(".")[1] ?? "";
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const subject = typeof claims === "object" && claims !== null ? Reflect.get(claims, "sub") : undefined;
    if (typeof subject === "string") return subject;
  } catch {
    // Not a JWT.
  }
  return "unidentified-session";
}

export async function getCurrentAccessToken(): Promise<string | null> {
  const stored = getStoredSession();
  if (!stored) return null;

  const { rawKey, data } = stored;
  const fields = sessionFields(data);
  const accessToken = fields.access_token;
  if (!accessToken) return null;

  // supabase-js v2 stores expires_at; legacy sessions used currentSession.expiresAt or a top-level expiresAt.
  const rawExpiresAt = fields.expires_at ?? fields.expiresAt ?? data.expiresAt;
  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = typeof rawExpiresAt === "number" && rawExpiresAt <= nowSec + 10;
  if (!isExpired) return accessToken;

  if (!fields.refresh_token) return null;
  // Concurrent callers for the same session share one request; a different session (another
  // user signed in meanwhile) gets its own instead of the old session's result.
  const refreshToken = fields.refresh_token;
  if (inFlightRefresh?.refreshToken !== refreshToken) {
    const promise: Promise<string | null> = refreshAccessToken(rawKey, refreshToken, data).finally(() => {
      if (inFlightRefresh?.promise === promise) inFlightRefresh = null;
    });
    inFlightRefresh = { refreshToken, promise };
  }
  return await inFlightRefresh.promise;
}
