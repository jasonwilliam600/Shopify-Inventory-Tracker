import { useClerk, useUser } from "@clerk/react";
import { LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ReviewerSignIn, useClerkConfigured } from "@/lib/clerk-host";

export function AccountMenu() {
  const configured = useClerkConfigured();
  if (!configured) return <span className="text-xs text-muted-foreground">Account unavailable</span>;
  return <ClerkAccountMenu />;
}

function ClerkAccountMenu() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  if (!isLoaded) return <span role="status" className="text-xs text-muted-foreground">Loading account…</span>;
  if (!isSignedIn || !user) return <ReviewerSignIn>Sign in</ReviewerSignIn>;

  const email = user.primaryEmailAddress?.emailAddress;
  const name = user.fullName || user.username;
  const label = name || email || "Signed-in account";
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase()
    : email ? Array.from(email)[0].toUpperCase() : "";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirectUrl: import.meta.env.BASE_URL });
    } catch {
      setSigningOut(false);
      toast({ title: "Unable to sign out", description: "Please try again.", variant: "destructive" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-9 shrink-0 rounded-full border-primary/30 bg-primary/10 p-0 text-primary"
          aria-label={`Account: ${label}`}
          disabled={signingOut}
        >
          {initials || <UserRound className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="break-words">
          <p>{label}</p>
          {email && email !== label && <p className="mt-1 text-xs font-normal text-muted-foreground">{email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => {
          try { openUserProfile(); }
          catch { toast({ title: "Unable to open account", description: "Please try again.", variant: "destructive" }); }
        }}>
          <UserRound className="mr-2 h-4 w-4" /> Account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void handleSignOut(); }} disabled={signingOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
