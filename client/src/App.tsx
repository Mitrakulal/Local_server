/**
 * Route contract: the public root is Nocturne Ledger owner chat; the existing
 * Instrument Panel load lab remains available only at the private /lab route.
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminConsole from "./pages/AdminConsole";
import OwnerChat from "./pages/OwnerChat";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={OwnerChat} />
      <Route path="/lab" component={Home} />
      <Route path="/admin" component={AdminConsole} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
