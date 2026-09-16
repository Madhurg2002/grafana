export interface HostEntry {
  instance: string;
  job: string;
  up: number;
}

export interface HostHealth {
  tenantId: string;
  timestamp: number;
  hosts: HostEntry[];
  upstream: "live" | "stale" | "error";
}

export interface SeriesPoint {
  timestamp: number;
  value: number;
}

export interface MetricSeries {
  label: string;
  points: SeriesPoint[];
}
