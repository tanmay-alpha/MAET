/**
 * Canonical access token provider for MAET frontend application.
 * Retrieves and automatically refreshes Supabase authentication tokens.
 */

// Both values are public by design (the anon key only grants what RLS allows) and must be
// VITE_-prefixed so Vite inlines them into the browser bundle; process.env is empty there.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ztpbfmpfgmgmsitshzma.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface SupabaseSessionData {
  currentSession?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    expiresAt?: number;
  };
  expiresAt?: number;
  access_token?: string;
  refresh_token?: string;
}

let refreshPromise: Promise<string | null> | null = null;

/** localStorage keys that hold a Supabase session ("supabase.auth.token" or "sb-<project>-auth-token"). */
function isSupabaseSessionKey(key: string): boolean {
  return key === "supabase.auth.token" || key.endsWith("-auth-token");
}

/**
 * Calls `onChange` when another tab signs in, signs out or refreshes the session.
 * (`storage` events only fire for writes made by other documents.)
 */
export function watchStoredSession(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // A null key means another tab called localStorage.clear().
    if (event.key === null || isSupabaseSessionKey(event.key)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
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

async function refreshAccessToken(
  rawKey: string,
  refreshToken: string,
  sessionData: SupabaseSessionData
): Promise<string | null> {
  // Supabase rejects refresh requests without the project's anon key.
  if (!SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      return null;
    }

    const refreshed = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      expires_at?: number;
      user?: unknown;
    };

    if (!refreshed.access_token) {
      return null;
    }

    const newExpiresAt = refreshed.expires_at ?? (refreshed.expires_in ? Math.floor(Date.now() / 1000) + refreshed.expires_in : Math.floor(Date.now() / 1000) + 3600);

    const updatedSession: SupabaseSessionData = {
      ...sessionData,
      currentSession: {
        ...(sessionData.currentSession ?? {}),
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? refreshToken,
        expires_at: newExpiresAt,
        expiresAt: newExpiresAt,
        ...(refreshed.user ? { user: refreshed.user } : {}),
      },
      expiresAt: newExpiresAt,
    };

    window.localStorage.setItem(rawKey, JSON.stringify(updatedSession));
    return refreshed.access_token;
  } catch {
    return null;
  }
}

/**
 * Whether this browser holds a Supabase session (an access token, possibly expired but
 * refreshable). Synchronous, for gating requests that only make sense when signed in.
 */
export function hasStoredSession(): boolean {
  const data = getStoredSession()?.data;
  return Boolean(data?.currentSession?.access_token || data?.access_token);
}

export async function getCurrentAccessToken(): Promise<string | null> {
  const stored = getStoredSession();
  if (!stored) {
    return null;
  }

  const { rawKey, data } = stored;
  const accessToken =
    data.currentSession?.access_token || data.access_token;
  const refreshToken =
    data.currentSession?.refresh_token || data.refresh_token;

  if (!accessToken) {
    return null;
  }

  const rawExpiresAt =
    data.currentSession?.expires_at ??
    data.currentSession?.expiresAt ??
    data.expiresAt;

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = typeof rawExpiresAt === "number" && rawExpiresAt <= nowSec + 10;

  if (!isExpired) {
    return accessToken;
  }

  // Handle token refresh
  if (!refreshToken) {
    return null;
  }

  if (refreshPromise) {
    return await refreshPromise;
  }

  refreshPromise = refreshAccessToken(rawKey, refreshToken, data).finally(() => {
    refreshPromise = null;
  });

  return await refreshPromise;
}
