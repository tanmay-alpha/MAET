import { Link, Outlet } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ClientOnly } from "@/components/common/client-only";
import { TickerTape } from "@/components/trading/ticker-tape";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function AppShell() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 min-w-0 items-center gap-3 border-b border-border bg-panel px-3">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-4 w-px bg-border" />
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs">
              {[
                { to: "/dashboard", label: "Dashboard" },
                { to: "/screener", label: "Screener" },
                { to: "/terminal", label: "Terminal" },
                { to: "/strategies", label: "Strategies" },
                { to: "/backtest", label: "Backtest" },
                { to: "/compare", label: "Compare" },
                { to: "/chart-grid", label: "Chart Grid" },
                { to: "/universe", label: "Universe" },
                { to: "/heatmap", label: "Heatmap" },
                { to: "/portfolio", label: "Portfolio" },
                { to: "/orders", label: "Orders" },
                { to: "/alerts", label: "Alerts" },
                { to: "/news", label: "News" },
                { to: "/settings", label: "Settings" },
                { to: "/futures", label: "Futures" },
              ].map((link) => (
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
            <div className="ml-auto hidden shrink-0 items-center gap-2 text-xs sm:flex">
              <div className="hidden items-center gap-1.5 rounded-md bg-panel-elevated px-2.5 py-1 md:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-muted-foreground">NSE</span>
                <span className="font-medium">Delayed</span>
              </div>
              <button aria-label="Notifications" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Bell className="h-4 w-4" />
              </button>
              <button aria-label="Settings" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Settings className="h-4 w-4" />
              </button>
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
