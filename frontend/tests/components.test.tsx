import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthBadge } from "../src/components/HealthBadge";
import { StatusCard } from "../src/components/StatusCard";
import { GaugeCard } from "../src/components/GaugeCard";
import { SparkLineCard } from "../src/components/SparkLineCard";
import { ConnectForm } from "../src/components/ConnectForm";
import { DashboardView } from "../src/components/DashboardView";
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
});

describe("ConnectForm", () => {
  it("submits and calls onConnected on success", async () => {
    const user = userEvent.setup();
    const onConnected = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: true, tenantId: "team-1", status: "connected", latencyMs: 9 }),
          { status: 200 }
        )
      )
    );
    render(<ConnectForm onConnected={onConnected} />);

    await user.type(screen.getByLabelText(/tenant id/i), "team-1");
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith("team-1");
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
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(onConnected).not.toHaveBeenCalled();
  });
});

describe("DashboardView", () => {
  it("renders the header with tenant and health badge", async () => {
    render(<DashboardView tenantId="team-9" />);
    expect(screen.getByText(/tenant: team-9/i)).toBeInTheDocument();
    expect(screen.getByTestId("health-badge")).toBeInTheDocument();
  });

  it("subscribes to the SSE stream for the tenant", async () => {
    render(<DashboardView tenantId="team-9" />);
    await waitFor(() => {
      expect(MockEventSource.lastInstance?.url).toContain("/api/stream?tenantId=team-9");
    });
  });
});
