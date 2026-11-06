import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { applyTheme, readStoredTheme, SETTINGS_STORAGE_KEY, type AppTheme } from "@/lib/theme";
import { clearMaetLocalData } from "@/lib/local-data";

const SOURCE_URL = "https://github.com/tanmay-alpha/MAET";

const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

// Shortcuts that are actually wired: the sidebar toggle (components/ui/sidebar.tsx) and the
// chart page handlers (useChartShortcuts in hooks/use-chart-layout.ts plus the period keys).
const SHORTCUTS: { scope: string; keys: string; action: string }[] = [
  { scope: "Anywhere", keys: "Ctrl/⌘ B", action: "Show or hide the sidebar" },
  { scope: "Chart", keys: "Alt ← / Alt →", action: "Previous / next period" },
  { scope: "Chart", keys: "+ / − / 0", action: "Zoom in / out / reset" },
  { scope: "Chart", keys: "← / →", action: "Pan" },
  { scope: "Chart", keys: "T H V F S", action: "Trendline, horizontal, vertical, Fibonacci, support/resistance" },
  { scope: "Chart", keys: "Esc", action: "Leave the drawing tool" },
  { scope: "Chart", keys: "F11", action: "Fullscreen" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-5 first:pt-0 last:border-b-0">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SettingsPage() {
  // Server render and first client render both use the default; the stored theme loads
  // after mount so hydration markup matches.
  const [theme, setTheme] = useState<AppTheme>("system");
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify({ appearance: { theme } });
    if (localStorage.getItem(SETTINGS_STORAGE_KEY) === serialized) return;
    localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [hydrated, theme]);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme("system");
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [hydrated, theme]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        <header className="mb-5 flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">Settings</h1>
          {saved && <span role="status" className="text-xs text-bull">Saved</span>}
        </header>

        <Section title="Theme">
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded border border-border bg-panel p-0.5 text-sm">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={`rounded px-3 py-1 ${
                  theme === option.value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Keyboard shortcuts">
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={`${shortcut.scope}-${shortcut.keys}`} className="border-b border-border/60 last:border-0">
                  <td className="w-24 py-1.5 pr-3 align-top text-xs text-muted-foreground">{shortcut.scope}</td>
                  <td className="w-36 whitespace-nowrap py-1.5 pr-3 align-top font-mono text-xs">{shortcut.keys}</td>
                  <td className="py-1.5 align-top">{shortcut.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Data in this browser">
          <p className="text-sm text-muted-foreground">
            Paper orders, alerts, watchlists and the journal live on the server under your account. This browser
            keeps only the theme, chart layouts, the chart grid and the guest watchlist.
          </p>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear MAET preferences and layouts stored in this browser?")) {
                clearMaetLocalData(window.localStorage);
                window.location.reload();
              }
            }}
            className="mt-3 rounded border border-bear/40 px-3 py-1.5 text-sm text-bear hover:bg-bear/10"
          >
            Clear browser data
          </button>
        </Section>

        <Section title="About">
          <ul className="space-y-1.5 text-sm">
            <li>
              Market data feeds and backend health: <Link to="/admin/data-quality" className="text-primary hover:underline">Data status</Link>
            </li>
            <li>
              <a href={`${SOURCE_URL}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Architecture notes</a>
              {" · "}
              <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Source on GitHub</a>
              {" · "}
              <a href={`${SOURCE_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Report an issue</a>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — MAET" }] }),
  component: SettingsPage,
});
