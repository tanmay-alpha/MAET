import { useSyncExternalStore } from "react";
import { hasStoredSession, watchStoredSession } from "@/lib/auth-token";

/**
 * Whether the browser holds a Supabase session. Gate signed-in-only queries on it so
 * logged-out visitors don't send requests that can only fail with 401. The server
 * render (and hydration) report false; the real value applies right after hydration.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(watchStoredSession, hasStoredSession, () => false);
}
