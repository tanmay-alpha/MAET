import { SIGN_IN_NOT_CONFIGURED_MESSAGE, loginHref } from "@/lib/auth-session";
import { supabaseAuthConfig } from "@/lib/auth-token";

const LINK_CLASS = "font-semibold underline underline-offset-2 hover:opacity-80";

/**
 * A link to /login that comes back to the current page after signing in or, when this
 * build has no Supabase project configured, a line saying sign-in is not available. A plain
 * anchor (the target is filled in on click), so it renders outside the router too.
 */
export function SignInLink({ label = "Sign in", className = LINK_CLASS }: { label?: string; className?: string }) {
  if (!supabaseAuthConfig()) return <span>{SIGN_IN_NOT_CONFIGURED_MESSAGE}</span>;
  return (
    <a
      href="/login"
      className={className}
      onClick={(event) => {
        event.currentTarget.href = loginHref(window.location.pathname + window.location.search);
      }}
    >
      {label}
    </a>
  );
}
