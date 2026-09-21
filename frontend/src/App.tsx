import { useEffect, useState } from "react";
import { BellRing, Radio } from "lucide-react";
import { motion } from "framer-motion";
import { AuthForm } from "./components/AuthForm";
import { ConnectForm } from "./components/ConnectForm";
import { DashboardView } from "./components/DashboardView";
import { ShareView } from "./components/ShareView";
import { ProfileView, type ProfilePage } from "./components/ProfileView";
import { LegalPage } from "./components/LegalPage";
import { ResetPage } from "./components/ResetPage";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { fetchConnectionInfo, type ConnectionInfo } from "./lib/api";

/** Window event the SSE hook fires on every alert transition (firing/resolved). */
export const ALERT_EVENT = "passthrough:alert";

interface HeaderAlert {
  alertId: number;
  title: string;
  state: "firing" | "resolved";
  value: number | null;
  threshold: number;
  comparator: string;
  firedAt: string;
}

type Route =
  | { name: "home" }
  | { name: "auth"; mode: "login" | "signup" }
  | { name: "share"; id: string }
  | { name: "profile"; page: ProfilePage }
  | { name: "reset" }
  | { name: "legal"; doc: "privacy" | "terms" }
  | { name: "not-found"; path: string };

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  // Share IDs are `shr_<hex>` — underscores must be in the accepted set.
  const shareMatch = /^\/share\/([A-Za-z0-9_-]+)$/.exec(path);
  if (shareMatch !== null) {
    return { name: "share", id: shareMatch[1] };
  }
  if (path === "/login") {
    return { name: "auth", mode: "login" };
  }
  if (path === "/signup") {
    return { name: "auth", mode: "signup" };
  }
  if (path === "/profile") {
    return { name: "profile", page: null };
  }
  const profileMatch = /^\/profile\/(security|sharing|orgs|activity)$/.exec(path);
  if (profileMatch !== null) {
    return { name: "profile", page: profileMatch[1] as ProfilePage };
  }
  if (path === "/reset") {
    return { name: "reset" };
  }
  if (path === "/privacy") {
    return { name: "legal", doc: "privacy" as const };
  }
  if (path === "/terms") {
    return { name: "legal", doc: "terms" as const };
  }
  if (path === "/" || path === "/index.html") {
    return { name: "home" };
  }
  return { name: "not-found", path };
}

function SignedInApp(): JSX.Element {
  const { user, logout } = useAuth();
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute);
  // Live firing-alert badge: the SSE hook broadcasts transitions on the
  // window; firing adds, resolved removes.
  const [firingAlerts, setFiringAlerts] = useState<Map<number, HeaderAlert>>(new Map());
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    function onAlert(event: Event): void {
      const alert = (event as CustomEvent<HeaderAlert>).detail;
      if (alert === undefined || typeof alert.alertId !== "number") {
        return;
      }
      setFiringAlerts((prev) => {
        const next = new Map(prev);
        if (alert.state === "firing") {
          next.set(alert.alertId, alert);
        } else {
          next.delete(alert.alertId);
        }
        return next;
      });
    }
    window.addEventListener(ALERT_EVENT, onAlert);
    return () => {
      window.removeEventListener(ALERT_EVENT, onAlert);
    };
  }, []);

  // Track URL changes (Profile link, back/forward) inside the signed-in app.
  useEffect(() => {
    function onPop(): void {
      setRoute(parseRoute());
    }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check(): Promise<void> {
      if (user === null) {
        setConnectionChecked(true);
        return;
      }
      try {
        const info = await fetchConnectionInfo(user.tenantId);
        if (!cancelled) setConnection(info);
      } catch {
        // 404 = never connected — show the connect panel.
        if (!cancelled) setConnection(null);
      } finally {
        if (!cancelled) setConnectionChecked(true);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function navigate(path: string): void {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  const tenantId = user?.tenantId ?? "default";
  const connected = connection !== null && connection.status === "connected";

  if (route.name === "profile") {
    return (
      <ProfileView
        page={route.page}
        navigate={navigate}
        onBack={() => {
          navigate("/");
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* SINGULAR header — the only chrome in the signed-in app. The embedded
          dashboard renders no header of its own. */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            title="Go to your dashboard"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Radio className="h-4 w-4 text-emerald-300" aria-hidden />
            Passthrough
          </button>
          <div className="flex items-center gap-3">
            {firingAlerts.size > 0 ? (
              <div className="relative">
                <button
                  type="button"
                  data-testid="alerts-badge"
                  title={
                    Array.from(firingAlerts.values())
                      .map((a) => `${a.title} — ${a.value ?? "no data"} ${a.comparator} ${a.threshold}`)
                      .join("\n") || "Alerts firing"
                  }
                  aria-label={`${firingAlerts.size} alert${firingAlerts.size === 1 ? "" : "s"} firing`}
                  onClick={() => setAlertsOpen((open) => !open)}
                  className="flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/20"
                >
                  <BellRing className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                  {firingAlerts.size}
                </button>
                {alertsOpen ? (
                  <div
                    className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-xl"
                    role="dialog"
                    aria-label="Firing alerts"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
                      Firing now
                    </p>
                    <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                      {Array.from(firingAlerts.values()).map((alert) => (
                        <li key={alert.alertId} className="rounded-lg border border-zinc-800/80 px-2.5 py-2">
                          <p className="text-xs font-medium text-zinc-200">{alert.title}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                            {alert.value !== null ? Number(alert.value.toFixed(3)) : "no data"} {alert.comparator} {alert.threshold} · since {new Date(alert.firedAt).toLocaleTimeString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-zinc-600">
                      Manage rules in the dashboard's Alerts section.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => navigate("/profile")}
              data-testid="profile-link"
              title="Your account, organizations, and everything shared with you"
              className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              Profile
            </button>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {user?.email ?? "signed in"}
            </span>
            <button
              type="button"
              onClick={logout}
              title="End this session on this device (your dashboards and shares stay)"
              className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        {connectionChecked && !connected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
            <h1 className="text-lg font-semibold tracking-tight">
              Connect your monitoring stack
            </h1>
            <p className="max-w-md text-center text-sm text-zinc-400">
              Paste your Prometheus URL — or a Grafana URL with a service-account
              token — and we handle the rest.
            </p>
            <ConnectForm
              onConnected={(connectedTenantId) => {
                void (async () => {
                  try {
                    setConnection(await fetchConnectionInfo(connectedTenantId));
                  } catch {
                    setConnection(null);
                  }
                })();
              }}
              fixedTenantId={tenantId}
            />
          </div>
        ) : (
          <DashboardView tenantId={tenantId} embedded />
        )}
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
          title="Free account — your dashboards, pages, and share links persist"
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
          title="Sign in to an existing account"
          className="block rounded-xl border border-zinc-800 px-4 py-3 text-center text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
        >
          Sign in
        </a>
        <button
          type="button"
          className="text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          title="Skip the account — connect straight to a Prometheus/Grafana endpoint"
          onClick={() => setConnected(true)}
        >
          or connect without an account
        </button>
      </div>
      <footer className="absolute bottom-4 w-full text-center text-[11px] text-zinc-600">
        <a
          href="/terms"
          title="Terms of Service"
          className="underline-offset-2 hover:text-zinc-400 hover:underline"
        >
          Terms
        </a>
        <span className="mx-2">·</span>
        <a
          href="/privacy"
          title="Privacy Policy"
          className="underline-offset-2 hover:text-zinc-400 hover:underline"
        >
          Privacy
        </a>
      </footer>
    </div>
  );
}/** Legacy no-account connect → dashboard flow. */
function ConnectFlow(): JSX.Element {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const { setTenantToken } = useAuth();

  /** Persists the workspace-scoped token so metrics/stream stay readable. */
  function handleConnected(connectedTenantId: string, tenantToken?: string): void {
    if (tenantToken !== undefined && tenantToken.length > 0) {
      setTenantToken(tenantToken);
    }
    setTenantId(connectedTenantId);
  }

  if (tenantId === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <h1 className="text-lg font-semibold tracking-tight">Connect an endpoint</h1>            <ConnectForm onConnected={handleConnected} />
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

function NotFoundPage({ path }: { path: string }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
        <Radio className="mx-auto h-8 w-8 text-zinc-600" aria-hidden />
      </motion.div>
      <h1 className="text-3xl font-bold tracking-tight">404</h1>
      <p className="max-w-sm text-sm text-zinc-400">
        Nothing lives at <span className="font-mono text-zinc-200">{path}</span> — the page
        may have been moved, or the link is wrong.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            window.history.pushState(null, "/", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
            window.location.assign("/");
          }}
          title="Open the app root"
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
        >
          Go to dashboard
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          title="Return to the previous page"
          className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

function Router(): JSX.Element {
  const { token, user, ready } = useAuth();
  const [route, setRoute] = useState<Route>(parseRoute);

  // Re-parse the URL on back/forward navigation and programmatic pushes.
  useEffect(() => {
    function onPop(): void {
      setRoute(parseRoute());
    }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Signed-in users sitting on /login or /signup go straight to the app.
  useEffect(() => {
    if (ready && token !== null && user !== null && route.name === "auth") {
      window.history.replaceState(null, "", "/");
      setRoute(parseRoute());
    }
  }, [ready, token, user, route.name]);

  if (route.name === "share") {
    return <SharePage id={route.id} />;
  }
  if (route.name === "auth") {
    return <AuthPage mode={route.mode} />;
  }
  if (route.name === "legal") {
    return <LegalPage doc={route.doc} />;
  }
  if (route.name === "reset") {
    return <ResetPage />;
  }
  if (route.name === "not-found") {
    return <NotFoundPage path={route.path} />;
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
