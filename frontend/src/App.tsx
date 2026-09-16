import { useState } from "react";
import { Radio } from "lucide-react";
import { motion } from "framer-motion";
import { AuthForm } from "./components/AuthForm";
import { ConnectForm } from "./components/ConnectForm";
import { DashboardView } from "./components/DashboardView";
import { ShareView } from "./components/ShareView";
import { AuthProvider, useAuth } from "./hooks/useAuth";

type Route =
  | { name: "home" }
  | { name: "auth"; mode: "login" | "signup" }
  | { name: "share"; id: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  const shareMatch = /^\/share\/([A-Za-z0-9-]+)$/.exec(path);
  if (shareMatch !== null) {
    return { name: "share", id: shareMatch[1] };
  }
  if (path === "/login") {
    return { name: "auth", mode: "login" };
  }
  if (path === "/signup") {
    return { name: "auth", mode: "signup" };
  }
  return { name: "home" };
}

function SignedInApp(): JSX.Element {
  const { user, logout } = useAuth();

  function navigate(path: string): void {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            Passthrough
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {user?.email ?? "signed in"}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <DashboardView tenantId={user?.tenantId ?? "default"} />
      </main>
    </div>
  );
}

function Home(): JSX.Element {
  const { token, user, ready } = useAuth();
  const [connected, setConnected] = useState<boolean>(false);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (token !== null && user !== null) {
    return <SignedInApp />;
  }

  // Not signed in: promote auth, but keep the connect form reachable.
  if (connected) {
    return <ConnectFlow />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-2 text-center"
      >
        <div className="flex items-center gap-2">
          <Radio className="h-6 w-6 text-emerald-300" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">Passthrough</h1>
        </div>
        <p className="max-w-md text-sm text-zinc-400">
          Monitoring without the Grafana learning curve. Paste a Prometheus or
          Grafana URL, sign in, and get a live mobile-first dashboard with
          shareable read-only links.
        </p>
      </motion.div>
      <div className="flex w-full max-w-md flex-col gap-3">
        <a
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState(null, "", "/signup");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="glass-card block rounded-xl px-4 py-3 text-center text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/40 hover:text-emerald-200"
        >
          Create an account
        </a>
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState(null, "", "/login");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="block rounded-xl border border-zinc-800 px-4 py-3 text-center text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
        >
          Sign in
        </a>
        <button
          type="button"
          className="text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          onClick={() => setConnected(true)}
        >
          or connect without an account
        </button>
      </div>
    </div>
  );
}

/** Legacy no-account connect → dashboard flow. */
function ConnectFlow(): JSX.Element {
  const [tenantId, setTenantId] = useState<string | null>(null);
  if (tenantId === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <h1 className="text-lg font-semibold tracking-tight">Connect an endpoint</h1>
        <ConnectForm onConnected={setTenantId} />
      </div>
    );
  }
  return <DashboardView tenantId={tenantId} />;
}

function SharePage({ id }: { id: string }): JSX.Element {
  return <ShareView id={id} />;
}

function AuthPage({ mode }: { mode: "login" | "signup" }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2">
        <Radio className="h-6 w-6 text-emerald-300" aria-hidden />
        <h1 className="text-2xl font-bold tracking-tight">Passthrough</h1>
      </div>
      <AuthForm initialMode={mode} />
    </div>
  );
}

function Router(): JSX.Element {
  const [route] = useState<Route>(parseRoute);
  if (route.name === "share") {
    return <SharePage id={route.id} />;
  }
  if (route.name === "auth") {
    return <AuthPage mode={route.mode} />;
  }
  return <Home />;
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
