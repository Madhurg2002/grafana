import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BellRing,
  Gauge,
  Radio,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { AuthForm } from "./components/AuthForm";
import { ConnectForm } from "./components/ConnectForm";
import { DashboardView } from "./components/DashboardView";
import { ShareView } from "./components/ShareView";
import { ProfileView, type ProfilePage } from "./components/ProfileView";
import { LegalPage } from "./components/LegalPage";
import { ResetPage } from "./components/ResetPage";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { fetchConnectionInfo, fetchFiringAlerts, type ConnectionInfo, pingBackend } from "./lib/api";

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
  /** Acknowledged alerts still fire; they just stop notifying. */
  acknowledged?: boolean;
  acknowledgedUntil?: string | null;
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

/** The product mark: one signal ring, used everywhere the brand appears. */
function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }): JSX.Element {
  const box = size === "lg" ? "h-10 w-10" : size === "md" ? "h-8 w-8" : "h-7 w-7";
  const icon = size === "lg" ? "h-5 w-5" : size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <span
      className={`relative flex ${box} shrink-0 items-center justify-center rounded-xl border border-[#5eead4]/30 bg-[#5eead4]/10 text-[#5eead4]`}
      aria-hidden
    >
      <span className="absolute inset-0 rounded-xl bg-[#5eead4]/10 blur-md" />
      <Radio className={`relative ${icon}`} />
    </span>
  );
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
  // Bumped on every SSE transition so a slow hydration response cannot
  // overwrite a fresher event with an older snapshot.
  const alertEventSeq = useRef(0);

  useEffect(() => {
    function onAlert(event: Event): void {
      const alert = (event as CustomEvent<HeaderAlert>).detail;
      alertEventSeq.current += 1;
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

  // The SSE stream only carries TRANSITIONS, so an alert that was already
  // firing before this tab opened would never appear. Seed the badge from the
  // server, and re-seed when the tab becomes visible again or once a minute so
  // alerts that resolved (or were deleted) while we were away clear too.
  useEffect(() => {
    if (user === null) {
      return;
    }
    const tenantId = user.tenantId;
    let cancelled = false;

    async function hydrate(retried = false): Promise<void> {
      const seqAtStart = alertEventSeq.current;
      try {
        const { alerts } = await fetchFiringAlerts(tenantId);
        if (cancelled) {
          return;
        }
        // A transition landed mid-flight and is fresher than this snapshot:
        // re-fetch once rather than clobbering the live state.
        if (alertEventSeq.current !== seqAtStart && !retried) {
          window.setTimeout(() => {
            void hydrate(true);
          }, 250);
          return;
        }
        setFiringAlerts(
          new Map(
            alerts.map((alert) => [
              alert.alertId,
              {
                alertId: alert.alertId,
                title: alert.title,
                state: "firing" as const,
                value: alert.value,
                threshold: alert.threshold,
                comparator: alert.comparator,
                firedAt: alert.firedAt,
                acknowledged: alert.acknowledged,
                acknowledgedUntil: alert.acknowledgedUntil,
              },
            ])
          )
        );
      } catch {
        // Signed out or backend unreachable — SSE keeps the badge live.
      }
    }

    void hydrate();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        void hydrate();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      void hydrate();
    }, 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [user]);

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
      <header className="chrome-bar sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            title="Go to your dashboard"
            className="group flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white"
          >
            <BrandMark size="sm" />
            <span className="transition group-hover:text-[#7df0dc]">Passthrough</span>
          </button>
          <div className="flex items-center gap-2">
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
                  className="flex items-center gap-1.5 rounded-full border border-[#fb7185]/40 bg-[#fb7185]/10 px-2.5 py-1 text-[11px] font-semibold text-[#fda4af] transition hover:bg-[#fb7185]/20"
                >
                  <BellRing className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                  {firingAlerts.size}
                </button>
                {alertsOpen ? (
                  <div
                    className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-white/[0.1] bg-[#080a0e] p-3 shadow-2xl"
                    role="dialog"
                    aria-label="Firing alerts"
                  >
                    <p className="eyebrow text-[#fda4af]">Firing now</p>
                    <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                      {Array.from(firingAlerts.values()).map((alert) => (
                        <li key={alert.alertId} className="rounded-lg border border-white/[0.075] px-2.5 py-2">
                          <p className="flex items-center gap-2 text-xs font-medium text-[#e6e9f0]">
                            {alert.title}
                            {alert.acknowledged === true ? (
                              <span className="chip chip-signal px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                                acked
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-[#5f6779]">
                            {alert.value !== null ? Number(alert.value.toFixed(3)) : "no data"} {alert.comparator} {alert.threshold} · since {new Date(alert.firedAt).toLocaleTimeString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-[#5f6779]">
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
              className="btn btn-ghost px-2.5 py-1"
            >
              Profile
            </button>
            <span className="hidden max-w-[18ch] truncate text-xs text-[#8d95a8] sm:inline">
              {user?.email ?? "signed in"}
            </span>
            <button
              type="button"
              onClick={logout}
              title="End this session on this device (your dashboards and shares stay)"
              className="btn btn-ghost px-2.5 py-1"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        {connectionChecked && !connected ? (
          <div className="mx-auto flex flex-1 flex-col items-center justify-center gap-5 px-4 py-10">
            <div className="max-w-md text-center">
              <p className="eyebrow">Step 1 of 1</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Connect your monitoring stack
              </h1>
              <p className="mt-2 text-sm text-[#8d95a8]">
                Paste a Prometheus URL — or a Grafana URL with a service-account
                token — and we handle the rest.
              </p>
            </div>
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

  // Someone is on the homepage: wake the API before they need it. Returning to
  // the tab pings again (throttled in pingBackend), so a sleeping instance has
  // usually booted by the time a real request is made.
  useEffect(() => {
    void pingBackend();
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        void pingBackend();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[#8d95a8]">
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

  function go(path: string): void {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex w-full max-w-2xl flex-col items-center text-center"
      >
        <div className="flex items-center gap-2.5">
          <BrandMark size="lg" />
          <span className="text-sm font-semibold uppercase tracking-label text-[#8d95a8]">
            Passthrough
          </span>
        </div>

        <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl">
          Prometheus metrics,
          <span className="bg-gradient-to-r from-[#5eead4] to-[#818cf8] bg-clip-text text-transparent">
            {" "}
            minus the Grafana tax
          </span>
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#8d95a8] sm:text-base">
          Paste one URL. Get live hosts, CPU, memory and network on a dashboard
          you can rearrange, share read-only, and alert on — straight from
          PromQL.
        </p>

        <div className="mt-8 flex w-full max-w-sm flex-col gap-2.5">
          <a
            href="/signup"
            onClick={(e) => {
              e.preventDefault();
              go("/signup");
            }}
            title="Free account — your dashboards, pages, and share links persist"
            className="btn btn-primary group w-full px-5 py-3 text-sm"
          >
            Create an account
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          </a>
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              go("/login");
            }}
            title="Sign in to an existing account"
            className="btn btn-ghost w-full px-5 py-3 text-sm"
          >
            Sign in
          </a>
          <button
            type="button"
            title="Skip the account — connect straight to a Prometheus/Grafana endpoint"
            onClick={() => setConnected(true)}
            className="btn btn-quiet mx-auto mt-1 text-[11px]"
          >
            or connect without an account
          </button>
        </div>

        <ul className="mt-12 grid w-full gap-2.5 text-left sm:grid-cols-3">
          {[
            { icon: Gauge, title: "Live in 5s", body: "One SSE poll per workspace, fanned out to every tab." },
            { icon: Share2, title: "Shareable views", body: "Anyone-link, email allow-list, or org-wide." },
            { icon: ShieldCheck, title: "Tokens sealed", body: "AES-256-GCM at rest; physical NICs only." },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="glass-card px-3.5 py-3">
              <Icon className="h-4 w-4 text-[#5eead4]" aria-hidden />
              <p className="mt-2 text-xs font-semibold text-[#e6e9f0]">{title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8d95a8]">{body}</p>
            </li>
          ))}
        </ul>
      </motion.div>

      <footer className="absolute bottom-4 flex w-full items-center justify-center gap-2 text-[11px] text-[#5f6779]">
        <a href="/terms" title="Terms of Service" className="transition hover:text-[#c3cad8]">
          Terms
        </a>
        <span aria-hidden>·</span>
        <a href="/privacy" title="Privacy Policy" className="transition hover:text-[#c3cad8]">
          Privacy
        </a>
      </footer>
    </div>
  );
}

/** Legacy no-account connect → dashboard flow. */
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <h1 className="text-lg font-semibold tracking-tight text-white">Connect an endpoint</h1>
        </div>
        <ConnectForm onConnected={handleConnected} />
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2.5">
        <BrandMark size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Passthrough</h1>
          <p className="text-[11px] uppercase tracking-label text-[#5f6779]">
            Prometheus, directly
          </p>
        </div>
      </div>
      <AuthForm initialMode={mode} />
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          window.history.pushState(null, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        className="btn btn-quiet text-[11px]"
      >
        ← Back to home
      </a>
    </div>
  );
}

function NotFoundPage({ path }: { path: string }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.09] bg-white/[0.03]">
          <Radio className="h-5 w-5 text-[#5f6779]" aria-hidden />
        </span>
      </motion.div>
      <h1 className="font-mono text-4xl font-semibold tracking-tight text-white">404</h1>
      <p className="max-w-sm text-sm text-[#8d95a8]">
        Nothing lives at <span className="code">{path}</span> — the page may have
        been moved, or the link is wrong.
      </p>
      <div className="mt-2 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            window.history.pushState(null, "/", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
            window.location.assign("/");
          }}
          title="Open the app root"
          className="btn btn-primary px-4 py-2 text-sm"
        >
          Go to dashboard
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          title="Return to the previous page"
          className="btn btn-ghost px-4 py-2 text-sm"
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
