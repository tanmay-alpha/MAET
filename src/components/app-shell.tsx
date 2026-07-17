import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";
import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ClientOnly } from "@/components/common/client-only";
import { TickerTape } from "@/components/trading/ticker-tape";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function AppShell() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const topLinks = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/screener", label: "Screener" },
    { to: "/terminal", label: "Terminal" },
    { to: "/chart-grid", label: "Chart Grid" },
    { to: "/universe", label: "Universe" },
    { to: "/compare", label: "Compare" },
    { to: "/strategies", label: "Strategies" },
    { to: "/backtest", label: "Backtest" },
  ];
  const currentLabel = topLinks.find((link) => pathname.startsWith(link.to))?.label ??
    pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ?? "MAET";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="relative z-40 flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-4 w-px bg-border" />
            <span className="min-w-0 flex-1 truncate capitalize text-sm font-medium lg:hidden">{currentLabel}</span>
            <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs lg:flex">
              {topLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="rounded px-2.5 py-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  activeProps={{ className: "rounded px-2.5 py-1 bg-accent text-foreground" }}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
              <div className="hidden items-center gap-1.5 rounded-md bg-panel-elevated px-2.5 py-1 md:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="text-muted-foreground">NSE</span>
                <span className="font-medium">Market</span>
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Notifications"
                  aria-expanded={notificationsOpen}
                  onClick={() => setNotificationsOpen((open) => !open)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Bell className="h-4 w-4" />
                </button>
                {notificationsOpen ? (
                  <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl">
                    <div className="font-medium">Notifications</div>
                    <p className="mt-1 text-xs text-muted-foreground">No unread notifications. Verified price alerts will appear here.</p>
                    <Link to="/alerts" onClick={() => setNotificationsOpen(false)} className="mt-3 inline-flex text-xs font-medium text-primary hover:underline">Open alert center</Link>
                  </div>
                ) : null}
              </div>
              <Link to="/settings" aria-label="Settings" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </header>
          <ClientOnly>
            <TickerTape />
          </ClientOnly>
          <main className="min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
