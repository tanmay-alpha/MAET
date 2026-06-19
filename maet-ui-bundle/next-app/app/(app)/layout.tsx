"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Settings } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TickerTape } from "@/components/trading/ticker-tape";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/screener", label: "Screener" },
  { to: "/terminal", label: "Terminal" },
  { to: "/strategies", label: "Strategies" },
  { to: "/backtest", label: "Backtest" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-12 items-center gap-3 border-b border-border bg-panel px-3">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-4 w-px bg-border" />
            <nav className="flex items-center gap-1 text-xs">
              {NAV.map((l) => {
                const active = pathname === l.to;
                return (
                  <Link
                    key={l.to}
                    href={l.to}
                    className={
                      "rounded px-2.5 py-1 transition " +
                      (active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <div className="hidden items-center gap-1.5 rounded-md bg-panel-elevated px-2.5 py-1 md:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse" />
                <span className="text-muted-foreground">NSE</span>
                <span className="font-medium">Open</span>
              </div>
              <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Bell className="h-4 w-4" />
              </button>
              <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </header>
          <TickerTape />
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
