import { ClerkProvider, SignIn, SignInButton, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useTheme } from "next-themes";

const rawPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const configuredKey = rawPublishableKey
  ? publishableKeyFromHost(window.location.hostname, rawPublishableKey)
  : "";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const ClerkConfigured = createContext(false);
export const useClerkConfigured = () => useContext(ClerkConfigured);

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

export function ClerkHost({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
      const ink = dark ? "#eaf0f8" : "#182437";
      const muted = dark ? "#a9b9ce" : "#6b7b8e";
  if (!configuredKey) {
    return <ClerkConfigured.Provider value={false}>{children}</ClerkConfigured.Provider>;
  }
  return (
    <ClerkProvider
      publishableKey={configuredKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      appearance={{
        variables: {
          colorPrimary: dark ? "#80bfff" : "#0878ee",
          colorBackground: dark ? "#14233a" : "#ffffff",
          colorForeground: ink,
          colorInput: dark ? "#101d30" : "#ffffff",
          colorInputForeground: ink,
          colorMutedForeground: muted,
          colorNeutral: ink,
          colorBorder: dark ? "#2c405a" : "#dce3ec",
          borderRadius: "6px",
          fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
        },
        elements: {
          rootBox: "w-full flex justify-center",
          cardBox: "bg-card rounded-md max-w-full overflow-hidden",
          card: "!shadow-none !border-0 !bg-transparent !rounded-none",
          footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
          headerTitle: { color: ink, fontWeight: 700 },
          headerSubtitle: { color: muted },
          formFieldLabel: { color: ink },
          formFieldInput: { color: ink, borderColor: dark ? "#2c405a" : "#dce3ec" },
          formButtonPrimary: { backgroundColor: dark ? "#0878ee" : "#0878ee", color: "#ffffff" },
          footerActionLink: { color: dark ? "#80bfff" : "#0878ee" },
          footerActionText: { color: muted },
        },
      }}
    >
      <ClerkConfigured.Provider value>
        <ClerkQueryClientCacheInvalidator />
        {children}
      </ClerkConfigured.Provider>
    </ClerkProvider>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const nextUserId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
      // Reset (rather than remove) mounted queries so the reviewer session
      // refetches after sign-in and no prior user's private data is retained.
      void queryClient.resetQueries();
    }
    previousUserId.current = nextUserId;
  }), [addListener, queryClient]);
  return null;
}

export function ReviewerSignIn({ children }: { children?: ReactNode }) {
  const configured = useContext(ClerkConfigured);
  if (!configured) {
    return <span className="auth-not-configured">Authentication is not configured for this workspace.</span>;
  }
  return (
    <SignInButton mode="modal">
      <button type="button" className="reviewer-sign-in">{children ?? "Sign in with Clerk"}</button>
    </SignInButton>
  );
}

export function ClerkSignInPage() {
  const configured = useContext(ClerkConfigured);
  const { resolvedTheme } = useTheme();
  if (!configured) return <AuthSetupMessage />;
  return <div className="clerk-page"><img className="clerk-auth-brand" src={`${import.meta.env.BASE_URL}${resolvedTheme === "dark" ? "tsh-brand-dark.svg" : "tsh-brand.svg"}`} alt="TSH Inventory Sync" /><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

export function ClerkSignUpPage() {
  const configured = useContext(ClerkConfigured);
  const { resolvedTheme } = useTheme();
  if (!configured) return <AuthSetupMessage />;
  return <div className="clerk-page"><img className="clerk-auth-brand" src={`${import.meta.env.BASE_URL}${resolvedTheme === "dark" ? "tsh-brand-dark.svg" : "tsh-brand.svg"}`} alt="TSH Inventory Sync" /><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function AuthSetupMessage() {
  return <main className="clerk-setup-message"><h1>Authentication is not configured</h1><p>Add the host-managed Clerk publishable key and proxy URL to enable reviewer sign-in. The public inventory dashboard remains available.</p></main>;
}
