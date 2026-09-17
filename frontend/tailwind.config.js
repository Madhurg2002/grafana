/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: "#09090b",
          900: "#18181b",
        },
      },
      boxShadow: {
        "glow-emerald": "0 0 24px -6px rgba(16, 185, 129, 0.45)",
        "glow-amber": "0 0 24px -6px rgba(245, 158, 11, 0.45)",
        "glow-rose": "0 0 24px -6px rgba(244, 63, 94, 0.45)",
      },
      screens: {
        // Ultra-wide density: 6-column wall-of-graphs on very large monitors.
        "3xl": "2200px",
      },
    },
  },
  plugins: [],
};
