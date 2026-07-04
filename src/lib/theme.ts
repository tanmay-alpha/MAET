export type AppTheme = "light" | "dark" | "system";

export const SETTINGS_STORAGE_KEY = "maet.settings";

export function applyTheme(theme: AppTheme): void {
  const dark = theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function readStoredTheme(): AppTheme {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as {
      appearance?: { theme?: unknown };
    } | null;
    const theme = saved?.appearance?.theme;
    return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
  } catch {
    return "system";
  }
}
