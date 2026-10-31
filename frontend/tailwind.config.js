/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Graphite canvas + hairline panels (see src/index.css tokens).
        ink: {
          950: "#06070a",
          900: "#0a0c11",
          800: "#0e1117",
          700: "#151922",
        },
        signal: {
          DEFAULT: "#5eead4",
          400: "#8df3e2",
          600: "#2dd4bf",
        },
        iris: {
          DEFAULT: "#818cf8",
          400: "#a5b4fc",
        },
        // Legacy alias kept so older surfaces keep resolving.
        obsidian: {
          950: "#06070a",
          900: "#0e1117",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      letterSpacing: {
        label: "0.16em",
      },
      boxShadow: {
        "glow-emerald": "0 0 24px -6px rgba(52, 211, 153, 0.45)",
        "glow-amber": "0 0 24px -6px rgba(245, 158, 11, 0.45)",
        "glow-rose": "0 0 24px -6px rgba(244, 63, 94, 0.45)",
        "panel-lift": "0 24px 48px -34px rgba(0, 0, 0, 0.9)",
        "signal-ring": "0 0 0 1px rgba(94, 234, 212, 0.25)",
      },
      screens: {
        // Ultra-wide density: 6-column wall-of-graphs on very large monitors.
        "3xl": "2200px",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.82)" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
        "rise-in": "rise-in 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
