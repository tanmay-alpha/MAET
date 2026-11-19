import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RouteErrorPanel } from "@/components/common/route-error-panel";

export const Route = createFileRoute("/_app")({
  component: AppShell,
  // A page that throws while rendering is replaced by a recoverable panel inside the shell,
  // so the sidebar and header stay usable. An error in the shell itself rethrows from here
  // and reaches the root error page.
  errorComponent: AppErrorComponent,
});

function AppErrorComponent(props: ErrorComponentProps) {
  return (
    <AppShell>
      <RouteErrorPanel {...props} />
    </AppShell>
  );
}
