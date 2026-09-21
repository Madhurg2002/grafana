import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthBadge } from "../src/components/HealthBadge";
import { StatusCard } from "../src/components/StatusCard";
import { GaugeCard } from "../src/components/GaugeCard";
import {
  formatChartTime,
  formatMetricValue,
  SparkLineCard,
} from "../src/components/SparkLineCard";
import { ConnectForm } from "../src/components/ConnectForm";
import { DashboardView } from "../src/components/DashboardView";
import { AuthProvider } from "../src/hooks/useAuth";
import { instantQuery } from "../src/lib/api";
import { csvFilename } from "../src/lib/csv";
import type { MetricSeries } from "../src/hooks/types";

// jsdom lacks EventSource — stub it.
class MockEventSource {
  public static lastInstance: MockEventSource | null = null;
  public listeners = new Map<string, (event: unknown) => void>();
  public onerror: (() => void) | null = null;
  public closed = false;

  public constructor(public url: string) {
    MockEventSource.lastInstance = this;
  }

  public addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  public close(): void {
    this.closed = true;
  }

  public emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

vi.stubGlobal("EventSource", MockEventSource);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ resultType: "vector", result: [], cached: false, query: "up" }), {
        status: 200,
      })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs?.();
});

describe("HealthBadge", () => {
  it("renders Live state", () => {
    render(<HealthBadge status="live" />);
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Live");
  });

  it("renders Connecting state", () => {
    render(<HealthBadge status="connecting" />);
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Connecting");
  });

  it("renders Disconnected state", () => {
    render(<HealthBadge status="disconnected" />);
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Disconnected");
  });
});

describe("StatusCard", () => {
  it("renders title, value and unit", () => {
    render(
      <StatusCard title="Hosts Up" value="3" unit="/ 4" level="emerald" icon={ServerIcon as never} />
    );
    expect(screen.getByTestId("status-card")).toHaveTextContent("Hosts Up");
    expect(screen.getByTestId("status-card")).toHaveTextContent("3");
    expect(screen.getByText("/ 4")).toBeInTheDocument();
  });
});

function ServerIcon(): JSX.Element {
  return <svg data-testid="icon" />;
}

describe("GaugeCard", () => {
  it("renders the clamped percentage", () => {
    render(<GaugeCard title="CPU Utilization" percent={42.5} level="emerald" />);
    expect(screen.getByTestId("gauge-card")).toHaveTextContent("42.5%");
  });

  it("clamps values above 100", () => {
    render(<GaugeCard title="CPU" percent={180} level="emerald" />);
    expect(screen.getByTestId("gauge-card")).toHaveTextContent("100.0%");
  });
});

describe("SparkLineCard", () => {
  const series: MetricSeries[] = [
    {
      label: "host-1",
      points: [
        { timestamp: 1758000000000, value: 1200 },
        { timestamp: 1758000060000, value: 3400 },
      ],
    },
  ];

  it("renders title and latest value", () => {
    render(
      <SparkLineCard title="Network RX" unit="bytes/s" series={series} stroke="#34d399" />
    );
    expect(screen.getByTestId("sparkline-card")).toHaveTextContent("Network RX");
    expect(screen.getByTestId("sparkline-card")).toHaveTextContent("3.4 KB/s");
  });

  it("renders empty state without crashing", () => {
    render(<SparkLineCard title="Network RX" unit="bytes/s" series={[]} stroke="#34d399" />);
    expect(screen.getByTestId("sparkline-card")).toBeInTheDocument();
  });

  it("formats each point timestamp independently", () => {
    expect(formatChartTime(1758000000000)).not.toBe(formatChartTime(1758000060000));
  });

  it("formats tooltip values without raw floating-point noise", () => {
    expect(formatMetricValue(50.73333333333333)).toBe("50.73");
    expect(formatMetricValue(1333.333, "bytes/s")).toBe("1.3 KB/s");
  });

  it("offers a CSV download when series data exists (none when empty)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:csv-test"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = clickSpy;
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);

    const { rerender } = render(
      <SparkLineCard title="Network RX" unit="bytes/s" series={[]} stroke="#34d399" />
    );
    expect(screen.queryByTestId("sparkline-csv")).toBeNull(); // empty → hidden

    rerender(<SparkLineCard title="Network RX" unit="bytes/s" series={series} stroke="#34d399" />);
    expect(screen.getByTestId("sparkline-csv")).toBeTruthy();
    await user.click(screen.getByTestId("sparkline-csv"));
    expect(clickSpy).toHaveBeenCalled();
    expect(anchors[0]?.download).toContain("Network-RX");
    vi.restoreAllMocks();
  });
});

describe("CSV helper", () => {
  it("escapes commas, quotes and newlines per RFC 4180", async () => {
    type CsvRow = Record<string, string | number>;
    let captured = "";
    const OriginalBlob = globalThis.Blob;
    const blobCtor = vi.fn((parts: BlobPart[], opts?: BlobPropertyBag) => {
      captured = String(parts[0] ?? "");
      return new OriginalBlob(parts, opts);
    });
    vi.stubGlobal("Blob", blobCtor);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:x"),
      revokeObjectURL: vi.fn(),
    });
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    }) as typeof document.createElement);
    const { downloadCsv: realDownload } = await import("../src/lib/csv");
    realDownload("t", [
      { label: "a,b", note: 'say "hi"' },
      { label: "line\nbreak", note: 3 },
    ] as unknown as CsvRow[]);
    expect(captured).toContain('"a,b"');
    expect(captured).toContain('"say ""hi"""');
    expect(captured).toContain('"line\nbreak"');
    expect(captured.split("\n")[0]).toBe("label,note");
    vi.restoreAllMocks();
  });

  it("builds a safe, timestamped filename from a widget title", () => {
    expect(csvFilename("CPU / memory (avg)")).toMatch(/^CPU-memory-avg-\d{4}-\d{2}-\d{2}$/);
    expect(csvFilename("###")).toMatch(/^widget-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("query request coalescing", () => {
  it("shares one network request for identical concurrent instant queries", async () => {
    // The batch endpoint echoes one result per request — mirror that shape.
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { requests?: unknown[] };
      return new Response(
        JSON.stringify({
          results: (body.requests ?? []).map(() => ({
            resultType: "vector",
            result: [],
            cached: false,
            query: "up",
          })),
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      instantQuery({ tenantId: "dedupe-test", query: "up" }),
      instantQuery({ tenantId: "dedupe-test", query: "up" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectForm", () => {
  it("submits and calls onConnected on success", async () => {
    const user = userEvent.setup();
    const onConnected = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            tenantId: "team-1",
            status: "connected",
            latencyMs: 9,
            tenantToken: "tenant-token-abc",
          }),
          { status: 200 }
        )
      )
    );
    render(<ConnectForm onConnected={onConnected} />);

    await user.type(screen.getByLabelText(/tenant id/i), "team-1");
    await user.type(screen.getByLabelText(/prometheus or grafana url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith("team-1", "tenant-token-abc");
    });
  });

  it("shows upstream error without calling onConnected on failure", async () => {
    const user = userEvent.setup();
    const onConnected = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "probe failed" }), { status: 502 })
      )
    );
    render(<ConnectForm onConnected={onConnected} />);

    await user.type(screen.getByLabelText(/tenant id/i), "team-1");
    await user.type(screen.getByLabelText(/prometheus or grafana url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(onConnected).not.toHaveBeenCalled();
  });
});

describe("DashboardView", () => {
  function renderDashboard(tenantId: string): void {
    render(
      <AuthProvider>
        <DashboardView tenantId={tenantId} />
      </AuthProvider>
    );
  }

  it("renders the header with connection label and health badge (no internal tenant IDs)", async () => {
    renderDashboard("team-9");
    // Internal tenant IDs are never rendered in the UI.
    expect(screen.queryByText(/tenant: team-9/i)).not.toBeInTheDocument();
    expect(screen.queryByText("team-9")).not.toBeInTheDocument();
    expect(screen.getByTestId("health-badge")).toBeInTheDocument();
  });

  it("renders a manual refresh control for signed-in sessions", async () => {
    localStorage.setItem("passthrough.token", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ resultType: "vector", result: [], cached: false, query: "up" }),
          { status: 200 }
        )
      )
    );
    renderDashboard("team-9");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refresh now/i })).toBeInTheDocument();
    });
    localStorage.removeItem("passthrough.token");
  });

  it("subscribes to the SSE stream for the tenant", async () => {
    renderDashboard("team-9");
    await waitFor(() => {
      expect(MockEventSource.lastInstance?.url).toContain("/api/stream?tenantId=team-9");
    });
  });

  it("hides the share button for anonymous sessions", async () => {
    renderDashboard("team-9");
    await waitFor(() => {
      expect(MockEventSource.lastInstance?.url).toContain("/api/stream");
    });
    expect(screen.queryByTestId("share-button")).not.toBeInTheDocument();
  });

  it("shows the share button for signed-in sessions and creates a link via the dialog", async () => {
    localStorage.setItem("passthrough.token", "t");
    const shareResponse = {
      id: "abc123",
      url: "/share/abc123",
      label: "default",
      createdAt: new Date().toISOString(),
      access: "anyone_view",
      invited: [],
      skipped: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/share")) {
          return new Response(JSON.stringify(shareResponse), { status: 201 });
        }
        if (url.includes("/api/orgs")) {
          return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ resultType: "vector", result: [], cached: false, query: "up" }),
          { status: 200 }
        );
      })
    );
    renderDashboard("team-9");
    await screen.findByTestId("share-button");
    await userEvent.setup().click(screen.getByTestId("share-button"));
    // Dialog opens → create with defaults (anyone · view).
    await waitFor(() => {
      expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByRole("button", { name: /create share link/i }));
    await waitFor(() => {
      expect(screen.getByTestId("copy-share-link")).toBeInTheDocument();
    });
    expect(screen.getByText(/\/share\/abc123/)).toBeInTheDocument();
    localStorage.removeItem("passthrough.token");
  });
});

describe("ShareView", () => {
  it("renders metrics from the share snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tenantId: "team-9",
            label: "demo",
            createdAt: new Date().toISOString(),
            metrics: {
              hosts: [{ instance: "h1", job: "node", up: 1 }],
              hostsUp: 1,
              hostsTotal: 1,
              cpuPercent: 21.5,
              ramPercent: 44,
            },
            generatedAt: new Date().toISOString(),
          }),
          { status: 200 }
        )
      )
    );
    const { ShareView } = await import("../src/components/ShareView");
    render(
      <AuthProvider>
        <ShareView id="abc123" />
      </AuthProvider>
    );
    expect(await screen.findByText("21.5%")).toBeInTheDocument();
    expect(screen.getByText("44.0%")).toBeInTheDocument();
    expect(screen.getByText("h1")).toBeInTheDocument();
  });

  it("shows an error state for revoked links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Share link not found or revoked" }), { status: 404 })
      )
    );
    const { ShareView } = await import("../src/components/ShareView");
    render(
      <AuthProvider>
        <ShareView id="gone" />
      </AuthProvider>
    );
    expect(await screen.findByText(/share link unavailable/i)).toBeInTheDocument();
  });
});

describe("AuthForm", () => {
  it("submits signup and stores the session", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            token: "tok",
            user: { id: "u1", email: "a@b.c", displayName: "A", tenantId: "t1" },
          }),
          { status: 201 }
        )
      )
    );
    const { AuthForm } = await import("../src/components/AuthForm");
    render(
      <AuthProvider>
        <AuthForm initialMode="signup" />
      </AuthProvider>
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.c");
    await user.type(screen.getByLabelText(/^password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(localStorage.getItem("passthrough.token")).toBe("tok");
    });
    localStorage.removeItem("passthrough.token");
  });
});

describe("ProfileView sub-pages", () => {
  /** Fetch mock covering the two profile endpoints the view loads. */
  function stubProfileFetches(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/profile/shares")) {
          return new Response(
            JSON.stringify({
              created: [
                {
                  id: "shr_1",
                  url: "/share/shr_1",
                  label: "ops",
                  access: "link_view",
                  allowedEmails: [],
                  revoked: false,
                  createdAt: new Date().toISOString(),
                },
              ],
              sharedWithMe: [],
            }),
            { status: 200 }
          );
        }
        if (url.includes("/api/profile/activity")) {
          return new Response(JSON.stringify({ activity: [] }), { status: 200 });
        }
        if (url.includes("/api/orgs")) {
          return new Response(JSON.stringify({ orgs: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders only the security section on /profile/security, with tab nav", async () => {
    stubProfileFetches();
    const { ProfileView } = await import("../src/components/ProfileView");
    render(
      <AuthProvider>
        <ProfileView page="security" onBack={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("account-settings")).toBeTruthy();
    });
    // Own section present.
    expect(screen.getByTestId("danger-zone")).toBeTruthy();
    // Other sections absent on this sub-page.
    expect(screen.queryByTestId("orgs-section")).toBeNull();
    expect(screen.queryByTestId("activity-section")).toBeNull();
    expect(screen.queryByText(/Created by me/)).toBeNull();
    // Tab navigation present and marks the active page.
    expect(screen.getByTestId("profile-tab-security").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("profile-tab-overview").getAttribute("href")).toBe("/profile");
  });

  it("renders only sharing lists on /profile/sharing", async () => {
    stubProfileFetches();
    const { ProfileView } = await import("../src/components/ProfileView");
    render(
      <AuthProvider>
        <ProfileView page="sharing" onBack={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Created by me/)).toBeTruthy();
    });
    expect(screen.queryByTestId("account-settings")).toBeNull();
    expect(screen.queryByTestId("orgs-section")).toBeNull();
    expect(screen.getByTestId("profile-tab-sharing").getAttribute("aria-current")).toBe("page");
  });

  it("keeps the hub all-in-one: every section renders with no page prop", async () => {
    stubProfileFetches();
    const { ProfileView } = await import("../src/components/ProfileView");
    render(
      <AuthProvider>
        <ProfileView onBack={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Created by me/)).toBeTruthy();
    });
    expect(screen.getByTestId("account-settings")).toBeTruthy();
    expect(screen.getByTestId("orgs-section")).toBeTruthy();
    expect(screen.getByTestId("activity-section")).toBeTruthy();
    // No tab is marked active on the hub beyond Overview.
    expect(screen.getByTestId("profile-tab-overview").getAttribute("aria-current")).toBe("page");
  });
});

describe("ResetPage", () => {
  it("requests a reset link and surfaces the dev fallback link when mail is unconfigured", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/request-reset")) {
        return new Response(
          JSON.stringify({ status: "dispatched", devResetUrl: "http://app/reset?token=abc123def456" }),
          { status: 202 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ResetPage } = await import("../src/components/ResetPage");
    render(
      <AuthProvider>
        <ResetPage />
      </AuthProvider>
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.c");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByTestId("reset-requested")).toBeTruthy();
    });
    expect(screen.getByTestId("dev-reset-link")).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("request-reset"));
    expect(call).toBeTruthy();
    const body1 = JSON.parse(String(call?.[1]?.body)) as { email: string };
    expect(body1).toEqual({ email: "a@b.c" });
    vi.unstubAllGlobals();
  });

  it("sets a new password from an emailed token and signs the user in", async () => {
    window.history.replaceState(null, "", "/reset?token=abc123def456ghij");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/reset")) {
        return new Response(
          JSON.stringify({
            token: "tok2",
            user: { id: "u1", email: "a@b.c", displayName: "A", tenantId: "t1" },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ResetPage } = await import("../src/components/ResetPage");
    render(
      <AuthProvider>
        <ResetPage />
      </AuthProvider>
    );
    await user.type(screen.getByLabelText(/new password/i), "newpassword1");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    await waitFor(() => {
      expect(localStorage.getItem("passthrough.token")).toBe("tok2");
    });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/reset"));
    const body2 = JSON.parse(String(call?.[1]?.body)) as { token: string; password: string };
    expect(body2).toEqual({ token: "abc123def456ghij", password: "newpassword1" });
    localStorage.removeItem("passthrough.token");
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });
});
