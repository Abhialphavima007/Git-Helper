/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The whole palette is CSS-variable driven so the app supports light and
      // dark modes plus runtime accent themes (see index.css + ThemePicker).
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
        },
        ok: { DEFAULT: "rgb(var(--ok) / <alpha-value>)", bg: "rgb(var(--ok-bg) / <alpha-value>)" },
        warn: { DEFAULT: "rgb(var(--warn) / <alpha-value>)", bg: "rgb(var(--warn-bg) / <alpha-value>)" },
        danger: { DEFAULT: "rgb(var(--danger) / <alpha-value>)", bg: "rgb(var(--danger-bg) / <alpha-value>)" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,24,31,0.04), 0 1px 3px rgba(20,24,31,0.06)",
      },
    },
  },
  plugins: [],
};
