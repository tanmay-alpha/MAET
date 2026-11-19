import { Link, useRouterState } from "@tanstack/react-router";
import { LogIn, LogOut, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useSessionEmail, useSessionExpired, useSignedIn } from "@/hooks/use-signed-in";
import { SIGN_IN_NOT_CONFIGURED_MESSAGE, signOut } from "@/lib/auth-session";
import { supabaseAuthConfig } from "@/lib/auth-token";

/** Header end: the account menu when signed in, otherwise a Sign in link back to this page. */
export function HeaderAuthControl() {
  const signedIn = useSignedIn();
  const email = useSessionEmail();
  const expired = useSessionExpired();
  const here = useRouterState({ select: (state) => state.location.href });

  if (signedIn) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <UserCircle className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="text-[11px] text-muted-foreground">Signed in as</div>
            <div className="truncate text-sm">{email ?? "your account"}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (!supabaseAuthConfig()) {
    return (
      <span className="px-1 text-[11px] text-muted-foreground" title={SIGN_IN_NOT_CONFIGURED_MESSAGE}>
        Sign-in not configured
      </span>
    );
  }
  return (
    <>
      {expired ? <span className="hidden text-[11px] text-amber-400 sm:inline">Session expired</span> : null}
      <Link
        to="/login"
        search={{ redirect: here }}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
      >
        Sign in
      </Link>
    </>
  );
}

/** Sidebar footer entry: who is signed in with Sign out, or Sign in; icon-only when collapsed. */
export function SidebarAuthControl() {
  const signedIn = useSignedIn();
  const email = useSessionEmail();
  const here = useRouterState({ select: (state) => state.location.href });

  if (!signedIn && !supabaseAuthConfig()) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        {SIGN_IN_NOT_CONFIGURED_MESSAGE}
      </p>
    );
  }
  return (
    <SidebarMenu>
      {signedIn ? (
        <>
          <SidebarMenuItem className="px-2 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
            <div className="font-medium">Paper Workstation</div>
            <div className="truncate text-muted-foreground">{email ?? "NSE Equity"}</div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </>
      ) : (
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Sign in">
            <Link to="/login" search={{ redirect: here }} className="flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              <span>Sign in</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  );
}
