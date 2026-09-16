/**
 * Read-only query set used by public share views. Every expression here
 * passes through the backend PromQL normalizer before execution, so the
 * safety laws (physical NIC filter, MemAvailable, >=[5m] rate windows)
 * are enforced regardless of this file's content.
 */
export const DEFAULT_PUBLIC_QUERIES = {
  hostsUp: "up",
  cpu: '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  ram: "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
  networkRx:
    'rate(node_network_receive_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
  networkTx:
    'rate(node_network_transmit_bytes_total{device=~"eth.*|ens.*|eno.*|bond.*"}[5m])',
} as const;
