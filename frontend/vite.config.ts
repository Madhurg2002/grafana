import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Extra hostnames the dev server may answer on (comma-separated). Kept in an
 * env var instead of the config so ephemeral preview hosts never get baked
 * into a tracked file, and auth/HTTPS behaviour stays untouched.
 */
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 5173),
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: false,
  },
});
