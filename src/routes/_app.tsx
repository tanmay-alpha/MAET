import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <AppShellFallback />;

  return (
    <Suspense fallback={<AppShellFallback />}>
      <ClientAppShell />
    </Suspense>
  );
}

const ClientAppShell = lazy(() =>
  import("@/components/app-shell").then((module) => ({ default: module.AppShell }))
);

function AppShellFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading MAET workspace…
    </div>
  );
}
