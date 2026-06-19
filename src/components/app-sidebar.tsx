import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, CandlestickChart, Cpu, FlaskConical, Table2 } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Screener", url: "/screener", icon: Table2 },
  { title: "Terminal", url: "/terminal", icon: CandlestickChart },
  { title: "Strategies", url: "/strategies", icon: Cpu },
  { title: "Backtest", url: "/backtest", icon: FlaskConical },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 px-2 py-2">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-sm surface-2">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-primary" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
              <path d="M3 19 L8 9 L13 14 L21 4" />
              <path d="M15 4 L21 4 L21 10" />
            </svg>
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <div className="text-tv-md font-semibold leading-none tracking-[0.16em]">MAET</div>
            <div className="text-tv-caps text-muted-foreground mt-1">Market · Edge · Terminal</div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Trade</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-bull" />
          <div className="text-xs">
            <div className="font-medium">Tanmay</div>
            <div className="text-muted-foreground">Paper · NSE</div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
