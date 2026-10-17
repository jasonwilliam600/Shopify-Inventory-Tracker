import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { Layout } from "@/components/layout";
import Dashboard from "@/pages/store-dashboard";
import Inventory from "@/pages/inventory";
import Suppliers from "@/pages/suppliers";
import SkuMappings from "@/pages/sku-mappings";
import Matrixify from "@/pages/matrixify";
import { ClerkHost, ClerkSignInPage, ClerkSignUpPage } from "@/lib/clerk-host";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={ClerkSignInPage} />
      <Route path="/sign-up/*?" component={ClerkSignUpPage} />
      <Route>
        <Layout>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/inventory" component={Inventory} />
              <Route path="/suppliers" component={Suppliers} />
              <Route path="/sku-mappings" component={SkuMappings} />
              <Route path="/matrixify" component={Matrixify} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </Layout>
      </Route>
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ClerkHost>
            <Router />
          </ClerkHost>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
