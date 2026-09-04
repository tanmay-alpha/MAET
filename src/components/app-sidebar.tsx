import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import {
  CandlestickChart,
  Table2,
  ListFilter,
  ClipboardList,
  Briefcase,
  Activity,
  Settings,
  Cpu,
  FlaskConical,
  LineChart,
  BarChart3,
  Search,
  Grid3x3,
  TrendingUp,
  Newspaper,
  ArrowUpDown,
  ChevronDown,
  BookOpen,
  Bell,
  Play,
  BarChart2,
  Layers,
} from "lucide-react";

const researchItems = [
  { title: "Screener", url: "/screener", icon: Table2 },
  { title: "Watchlists", url: "/watchlists", icon: ListFilter },
];

const tradingItems = [
  { title: "Terminal", url: "/terminal", icon: CandlestickChart },
  { title: "Orders", url: "/orders", icon: ClipboardList },
  { title: "Portfolio", url: "/portfolio", icon: Briefcase },
];

const reviewItems = [
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Alerts", url: "/alerts", icon: Bell },
];

const systemItems = [
  { title: "Data Status", url: "/admin/data-quality", icon: Activity },
  { title: "Settings", url: "/settings", icon: Settings },
];

const strategyItems = [
  { title: "Strategy Lab", url: "/strategies", icon: FlaskConical },
  { title: "Performance", url: "/performance", icon: BarChart2 },
  { title: "Bar Replay", url: "/replay", icon: Play },
];

const experimentalItems = [
  { title: "Chart Grid", url: "/chart-grid", icon: Grid3x3 },
  { title: "Compare", url: "/compare", icon: ArrowUpDown },
  { title: "Universe", url: "/universe", icon: Search },
  { title: "Heatmap", url: "/heatmap", icon: TrendingUp },
  { title: "Backtest", url: "/backtest", icon: Layers },
  { title: "Options", url: "/options/RELIANCE", icon: LineChart },
  { title: "Futures", url: "/futures", icon: BarChart3 },
  { title: "News", url: "/news", icon: Newspaper },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [showExperimental, setShowExperimental] = useState(false);

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
            <div className="text-tv-caps text-muted-foreground mt-1">Research & Paper Execution</div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* RESEARCH */}
        <SidebarGroup>
          <SidebarGroupLabel>Research</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {researchItems.map((item) => (
                <SidebarMenuItem key={item.url + item.title}>
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

        {/* TRADING */}
        <SidebarGroup>
          <SidebarGroupLabel>Trading</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {tradingItems.map((item) => (
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

        {/* REVIEW */}
        <SidebarGroup>
          <SidebarGroupLabel>Review</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {reviewItems.map((item) => (
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

        {/* STRATEGY */}
        <SidebarGroup>
          <SidebarGroupLabel>Strategy Lab</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {strategyItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(item.url)} tooltip={item.title}>
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

        {/* SYSTEM */}
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => (
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

        {/* EXPERIMENTAL */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel
            className="cursor-pointer flex items-center justify-between text-xs text-muted-foreground/70 hover:text-muted-foreground"
            onClick={() => setShowExperimental((prev) => !prev)}
          >
            <span>Experimental</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${showExperimental ? "rotate-180" : ""}`} />
          </SidebarGroupLabel>
          {showExperimental && (
            <SidebarGroupContent>
              <SidebarMenu>
                {experimentalItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2 text-muted-foreground">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-bull flex items-center justify-center text-white text-xs font-bold">
            M
          </div>
          <div className="text-xs">
            <div className="font-medium">Paper Workstation</div>
            <div className="text-muted-foreground">NSE Equity</div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
