import { ClerkProvider, SignIn, SignInButton, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";

const rawPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const configuredKey = rawPublishableKey
  ? publishableKeyFromHost(window.location.hostname, rawPublishableKey)
  : "";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const ClerkConfigured = createContext(false);

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

export function ClerkHost({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
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
          colorPrimary: "#294f83",
          colorBackground: "#fbfcfd",
          colorForeground: "#18324d",
          colorInput: "#ffffff",
          colorInputForeground: "#18324d",
          borderRadius: "6px",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        },
        elements: {
          rootBox: "w-full flex justify-center",
          cardBox: "bg-[#fbfcfd] rounded-md w-[440px] max-w-full overflow-hidden",
          card: "!shadow-none !border-0 !bg-transparent !rounded-none",
          footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
          headerTitle: { color: "#18324d", fontWeight: 700 },
          headerSubtitle: { color: "#64758a" },
          formFieldLabel: { color: "#18324d" },
          formFieldInput: { color: "#18324d", borderColor: "#dce4ec" },
          formButtonPrimary: { backgroundColor: "#294f83" },
          footerActionLink: { color: "#294f83" },
          footerActionText: { color: "#64758a" },
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
  if (!configured) return <AuthSetupMessage />;
  return <div className="clerk-page"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

export function ClerkSignUpPage() {
  const configured = useContext(ClerkConfigured);
  if (!configured) return <AuthSetupMessage />;
  return <div className="clerk-page"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function AuthSetupMessage() {
  return <main className="clerk-setup-message"><h1>Authentication is not configured</h1><p>Add the host-managed Clerk publishable key and proxy URL to enable reviewer sign-in. The public inventory dashboard remains available.</p></main>;
}
