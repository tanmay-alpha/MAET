import { ShieldAlert, AlertTriangle, CheckCircle2, Wifi, Clock, Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";

export type WorkspaceReadinessState =
  | "READY_LIVE"
  | "READY_DELAYED"
  | "READY_HISTORICAL"
  | "MARKET_CLOSED"
  | "AUTH_REQUIRED"
  | "BACKEND_STARTING"
  | "DATA_DEGRADED"
  | "TRADING_UNAVAILABLE";

interface TerminalReadinessBannerProps {
  state: WorkspaceReadinessState;
  sourceLabel?: string;
  quoteAgeSeconds?: number;
}

export function TerminalReadinessBanner({
  state,
  sourceLabel = "Angel One",
  quoteAgeSeconds = 0,
}: TerminalReadinessBannerProps) {
  if (state === "READY_LIVE") return null;

  switch (state) {
    case "READY_DELAYED":
      return (
        <div className="flex items-center justify-between bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5" />
            <span>Angel One live stream unavailable. Using delayed market quotes from <strong>{sourceLabel}</strong>.</span>
          </div>
          <span className="text-[10px] opacity-75">Market execution active</span>
        </div>
      );

    case "READY_HISTORICAL":
    case "MARKET_CLOSED":
      return (
        <div className="flex items-center justify-between bg-blue-500/10 border-b border-blue-500/20 px-4 py-1.5 text-xs text-blue-300">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            <span>Indian stock market is currently closed. Displaying latest stored session candles.</span>
          </div>
          <span className="text-[10px] opacity-75">Limit orders accepted</span>
        </div>
      );

    case "AUTH_REQUIRED":
      return (
        <div className="flex items-center justify-between bg-purple-500/10 border-b border-purple-500/20 px-4 py-1.5 text-xs text-purple-300">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            <span>Paper trading requires an active session. Sign in to place orders and manage positions.</span>
          </div>
          <Link to="/settings" className="font-semibold underline hover:text-purple-200">
            Sign In / Register
          </Link>
        </div>
      );

    case "DATA_DEGRADED":
      return (
        <div className="flex items-center justify-between bg-bear/10 border-b border-bear/20 px-4 py-1.5 text-xs text-bear">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Quote is stale ({quoteAgeSeconds}s old). MARKET paper orders are disabled until fresh ticks arrive.</span>
          </div>
          <span className="font-mono text-[10px]">Stale Data Warning</span>
        </div>
      );

    case "BACKEND_STARTING":
      return (
        <div className="flex items-center gap-2 bg-panel border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
          <span>Paper trading backend service starting up...</span>
        </div>
      );

    case "TRADING_UNAVAILABLE":
    default:
      return (
        <div className="flex items-center justify-between bg-bear/10 border-b border-bear/20 px-4 py-1.5 text-xs text-bear">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Paper trading workstation unavailable due to backend connection failure.</span>
          </div>
          <span className="font-medium text-[10px]">Disabled</span>
        </div>
      );
  }
}
