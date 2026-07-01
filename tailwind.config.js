/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F8FA",
        card: "#FFFFFF",
        ink: "#14181F",
        muted: "#5B6573",
        line: "#E2E6EC",
        accent: { DEFAULT: "#3B5BDB", hover: "#314CC0" },
        ok: { DEFAULT: "#1F8A53", bg: "#E7F4ED" },
        warn: { DEFAULT: "#B26A00", bg: "#FBF0DC" },
        danger: { DEFAULT: "#C2392F", bg: "#FBE9E7" },
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
