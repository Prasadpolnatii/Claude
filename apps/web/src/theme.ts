import { useEffect, useState } from "react";

/**
 * Dark/light theme. Dark is the default (on-call dashboards live in dark rooms).
 * The choice is persisted and applied as `data-theme` on <html>; styles.css
 * overrides the CSS variables for `[data-theme="light"]`.
 */
export type Theme = "dark" | "light";

const KEY = "ops_theme";

function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "light" ? "light" : "dark";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}
