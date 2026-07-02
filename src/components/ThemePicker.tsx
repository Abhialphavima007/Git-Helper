import { useEffect, useState } from "react";

// Five accent themes the user can pick from the navbar. Each is a pair of
// space-separated RGB triples (base + hover) applied as CSS variables, which
// Tailwind's `accent` color reads. Persisted in localStorage.
const THEMES = [
  { id: "indigo", label: "Indigo", accent: "59 91 219", hover: "49 76 192" },
  { id: "violet", label: "Violet", accent: "112 72 232", hover: "95 61 197" },
  { id: "teal", label: "Teal", accent: "12 133 153", hover: "10 113 130" },
  { id: "rose", label: "Rose", accent: "214 51 108", hover: "184 44 93" },
  { id: "orange", label: "Orange", accent: "232 89 12", hover: "200 77 10" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
const STORAGE_KEY = "githelper.theme";

function apply(theme: (typeof THEMES)[number]) {
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-hover", theme.hover);
}

// Restore the saved theme as early as the component mounts.
export function useThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const theme = THEMES.find((t) => t.id === saved);
    if (theme) apply(theme);
  }, []);
}

export function ThemePicker() {
  const [active, setActive] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (THEMES.find((t) => t.id === saved)?.id ?? "indigo") as ThemeId;
  });

  function pick(theme: (typeof THEMES)[number]) {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme.id);
    setActive(theme.id);
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Accent color">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => pick(t)}
          title={t.label}
          aria-label={`${t.label} theme`}
          className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
            active === t.id ? "border-ink" : "border-transparent"
          }`}
          style={{ backgroundColor: `rgb(${t.accent})` }}
        />
      ))}
    </div>
  );
}
