import { useEffect, useState } from "react";

// Appearance controls shown in the navbar: light/dark mode plus five accent
// colors. Both are persisted; dark mode defaults to the system preference.
const THEMES = [
  { id: "indigo", label: "Indigo", accent: "59 91 219", hover: "49 76 192" },
  { id: "violet", label: "Violet", accent: "112 72 232", hover: "95 61 197" },
  { id: "teal", label: "Teal", accent: "12 133 153", hover: "10 113 130" },
  { id: "rose", label: "Rose", accent: "214 51 108", hover: "184 44 93" },
  { id: "orange", label: "Orange", accent: "232 89 12", hover: "200 77 10" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
type Mode = "light" | "dark";

const ACCENT_KEY = "githelper.theme";
const MODE_KEY = "githelper.mode";

// Dark accents need a bit more brightness to read well on dark surfaces.
const DARK_ACCENTS: Record<ThemeId, { accent: string; hover: string }> = {
  indigo: { accent: "122 148 250", hover: "146 168 252" },
  violet: { accent: "158 128 249", hover: "177 152 251" },
  teal: { accent: "66 190 213", hover: "94 204 224" },
  rose: { accent: "244 114 160", hover: "247 141 179" },
  orange: { accent: "250 139 71", hover: "252 160 100" },
};

function currentMode(): Mode {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentAccent(): ThemeId {
  const saved = localStorage.getItem(ACCENT_KEY);
  return (THEMES.find((t) => t.id === saved)?.id ?? "indigo") as ThemeId;
}

function applyAll(mode: Mode, accentId: ThemeId) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  const light = THEMES.find((t) => t.id === accentId)!;
  const pair = mode === "dark" ? DARK_ACCENTS[accentId] : { accent: light.accent, hover: light.hover };
  root.style.setProperty("--accent", pair.accent);
  root.style.setProperty("--accent-hover", pair.hover);
}

// Restore the saved appearance as early as the layout mounts.
export function useThemeInit() {
  useEffect(() => {
    applyAll(currentMode(), currentAccent());
  }, []);
}

export function ThemePicker() {
  const [mode, setMode] = useState<Mode>(currentMode);
  const [accent, setAccent] = useState<ThemeId>(currentAccent);

  function pickAccent(id: ThemeId) {
    localStorage.setItem(ACCENT_KEY, id);
    setAccent(id);
    applyAll(mode, id);
  }

  function toggleMode() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
    applyAll(next, accent);
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Light / dark toggle */}
      <button
        onClick={toggleMode}
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper hover:text-ink"
      >
        {mode === "dark" ? (
          // Sun
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          // Moon
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>

      <span className="h-4 w-px bg-line" aria-hidden />

      {/* Accent swatches */}
      <div className="flex items-center gap-1.5" role="group" aria-label="Accent color">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => pickAccent(t.id)}
            title={t.label}
            aria-label={`${t.label} theme`}
            className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
              accent === t.id ? "border-ink" : "border-transparent"
            }`}
            style={{ backgroundColor: `rgb(${t.accent})` }}
          />
        ))}
      </div>
    </div>
  );
}
