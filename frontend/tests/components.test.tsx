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
    render(<ShareView id="abc123" />);
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
    render(<ShareView id="gone" />);
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
