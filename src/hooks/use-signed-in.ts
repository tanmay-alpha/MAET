import { useSyncExternalStore } from "react";
import { hasStoredSession, sessionEndedByExpiry, storedSessionEmail, watchStoredSession } from "@/lib/auth-token";

/**
 * Whether the browser holds a Supabase session. Gate signed-in-only queries on it so
 * logged-out visitors don't send requests that can only fail with 401. The server
 * render (and hydration) report false; the real value applies right after hydration.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(watchStoredSession, hasStoredSession, () => false);
}

/** The signed-in user's email (null when signed out or not recorded in the session). */
export function useSessionEmail(): string | null {
  return useSyncExternalStore(watchStoredSession, storedSessionEmail, () => null);
}

/** True after a session ended because it could no longer be refreshed, until the next sign-in. */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(watchStoredSession, sessionEndedByExpiry, () => false);
}
