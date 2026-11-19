import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSessionEmail, useSessionExpired, useSignedIn } from "@/hooks/use-signed-in";
import {
  SIGN_IN_NOT_CONFIGURED_MESSAGE,
  safeRedirectPath,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "@/lib/auth-session";
import { supabaseAuthConfig } from "@/lib/auth-token";

export const Route = createFileRoute("/login")({
  // authError: why an email link (sign-up confirmation, magic link) could not sign in; set by
  // the root route after it strips the auth fragment Supabase redirected back with.
  validateSearch: (search: Record<string, unknown>): { redirect?: string; authError?: string } => ({
    ...(typeof search.redirect === "string" ? { redirect: search.redirect } : {}),
    ...(typeof search.authError === "string" ? { authError: search.authError } : {}),
  }),
  head: () => ({ meta: [{ title: "Sign in — MAET" }] }),
  component: LoginPage,
});

type Mode = "sign-in" | "sign-up";

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/60 focus:outline-none disabled:opacity-60";
const PRIMARY_BUTTON =
  "w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

function LoginPage() {
  const { redirect, authError } = Route.useSearch();
  const destination = safeRedirectPath(redirect);
  const router = useRouter();
  const signedIn = useSignedIn();
  const email = useSessionEmail();
  const expired = useSessionExpired();
  const configured = supabaseAuthConfig() !== null;

  const [mode, setMode] = useState<Mode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  // The form is server-rendered; until React handles submit, a native submit would post
  // the password to the page itself. Keep it disabled until hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    if (mode === "sign-in") {
      const result = await signInWithPassword(address, password);
      if (result.ok) {
        router.history.push(destination);
        return;
      }
      setError(result.message);
    } else {
      const result = await signUpWithPassword(address, password);
      if (result.status === "signed-in") {
        router.history.push(destination);
        return;
      }
      if (result.status === "confirmation-required") setConfirmationSentTo(result.email);
      else setError(result.message);
    }
    setPending(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  let body;
  if (!configured) {
    body = (
      <>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p role="status" className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          {SIGN_IN_NOT_CONFIGURED_MESSAGE} Market research works without an account.
        </p>
        <Link to="/screener" className={`${PRIMARY_BUTTON} mt-4 inline-block text-center`}>
          Open the screener
        </Link>
      </>
    );
  } else if (signedIn) {
    body = (
      <>
        <h1 className="text-lg font-semibold">You're signed in</h1>
        <p className="mt-2 break-words text-sm text-muted-foreground">{email ? `Signed in as ${email}.` : "This browser holds a session."}</p>
        <a href={destination} className={`${PRIMARY_BUTTON} mt-4 inline-block text-center`}>
          Continue
        </a>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Sign out
        </button>
      </>
    );
  } else if (confirmationSentTo) {
    body = (
      <>
        <MailCheck aria-hidden="true" className="h-6 w-6 text-primary" />
        <h1 className="mt-3 text-lg font-semibold">Check your email</h1>
        <p role="status" className="mt-2 break-words text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{confirmationSentTo}</span>. Open it, then sign in here.
        </p>
        <button
          type="button"
          onClick={() => {
            setConfirmationSentTo(null);
            switchMode("sign-in");
          }}
          className="mt-4 w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Back to sign in
        </button>
      </>
    );
  } else {
    const signingIn = mode === "sign-in";
    body = (
      <>
        <h1 className="text-lg font-semibold">{signingIn ? "Sign in" : "Create an account"}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {signingIn ? "Your paper account, orders and saved research." : "A paper trading account with virtual cash. No real orders are placed."}
        </p>
        {expired && signingIn ? (
          <p role="status" className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            Your session expired. Sign in again to continue.
          </p>
        ) : null}
        {authError && signingIn ? (
          <p role="alert" className="mt-3 rounded border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">
            {authError}
          </p>
        ) : null}
        <form method="post" onSubmit={(event) => void onSubmit(event)} className="mt-4 space-y-3">
          <label className="block text-xs font-medium">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={!hydrated || pending}
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
          <label className="block text-xs font-medium">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={signingIn ? undefined : 6}
              autoComplete={signingIn ? "current-password" : "new-password"}
              disabled={!hydrated || pending}
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
          {error ? (
            <p role="alert" className="rounded border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={!hydrated || pending} className={PRIMARY_BUTTON}>
            {pending ? (signingIn ? "Signing in…" : "Creating account…") : signingIn ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {signingIn ? "New to MAET? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => switchMode(signingIn ? "sign-up" : "sign-in")}
            disabled={!hydrated}
            className="font-semibold text-primary hover:underline"
          >
            {signingIn ? "Create an account" : "Sign in"}
          </button>
        </p>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <Link to="/" aria-label="MAET home" className="text-base font-semibold tracking-[0.16em]">
            MAET
          </Link>
          <Link to="/screener" className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            Continue without an account
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <section aria-label="Account" className="w-full max-w-sm rounded-lg border border-border bg-panel p-6">
          {body}
        </section>
      </main>
    </div>
  );
}
