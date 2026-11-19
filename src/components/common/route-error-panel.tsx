import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Shown in place of a page that threw while rendering (a chart or table fed data it could
 * not handle), inside the app shell so navigation keeps working. "Try again" drops the
 * cached data of the crashed page — its queries have no observers left — so the retry
 * fetches fresh data instead of re-rendering what crashed; moving to another page also
 * clears the error.
 */
export function RouteErrorPanel({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const crashedAt = useRef(pathname);
  const [retrying, setRetrying] = useState(false);
  const detail = error instanceof Error ? error.message : String(error);

  useEffect(() => {
    if (pathname !== crashedAt.current) reset();
  }, [pathname, reset]);

  const retry = async () => {
    setRetrying(true);
    try {
      queryClient.removeQueries({ type: "inactive" });
      await router.invalidate();
    } finally {
      setRetrying(false);
      reset();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div role="alert" className="mx-auto max-w-xl rounded-lg border border-bear/40 bg-bear/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-bear" />
          This page stopped working
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Part of this page failed to render. The rest of MAET still works: try again, or open another page from the menu.
        </p>
        {detail ? (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Error details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">{detail}</pre>
          </details>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
          <Link to="/dashboard" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
