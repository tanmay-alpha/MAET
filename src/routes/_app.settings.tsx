import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Settings, Bell, Database, Palette, Keyboard, BookOpen, User, Shield, Moon, Sun, Monitor, Save, RotateCcw, Check, ArrowUpRight } from "lucide-react";
import { PaperModeBanner } from "@/components/common/paper-mode-banner";
import { ContractPanel } from "@/components/common/contract-panel";
import { applyTheme, SETTINGS_STORAGE_KEY, type AppTheme } from "@/lib/theme";

type Theme = AppTheme;

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

type SettingsSection = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    title: "General",
    description: "Application preferences and behavior",
    icon: Settings,
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Alerts and price notifications",
    icon: Bell,
  },
  {
    id: "data",
    title: "Data Sources",
    description: "Configure market data feeds",
    icon: Database,
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and display options",
    icon: Palette,
  },
  {
    id: "keyboard",
    title: "Keyboard",
    description: "Hotkeys and shortcuts",
    icon: Keyboard,
  },
  {
    id: "privacy",
    title: "Privacy & Security",
    description: "Data and security settings",
    icon: Shield,
  },
  {
    id: "help",
    title: "Help & Support",
    description: "Documentation and assistance",
    icon: BookOpen,
  },
];

type SettingKey = "autoRefresh" | "paperBanner" | "emailAlerts" | "inAppAlerts" | "yahooData";

type SettingsState = {
  general: {
    autoRefresh: boolean;
    paperBanner: boolean;
  };
  notifications: {
    emailAlerts: boolean;
    inAppAlerts: boolean;
  };
  data: {
    yahooData: boolean;
  };
  appearance: {
    theme: Theme;
  };
};

const DEFAULT_SETTINGS: SettingsState = {
  general: {
    autoRefresh: true,
    paperBanner: true,
  },
  notifications: {
    emailAlerts: false,
    inAppAlerts: true,
  },
  data: {
    yahooData: true,
  },
  appearance: {
    theme: "system",
  },
};

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm">{label}</span>
      <div className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={enabled}
          onChange={onToggle}
        />
        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
      </div>
    </label>
  );
}

function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");
  const [settings, setSettings] = useState<SettingsState>(() => {
    // Load from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Partial<SettingsState> | null;
      return saved ? {
        general: { ...DEFAULT_SETTINGS.general, ...saved.general },
        notifications: { ...DEFAULT_SETTINGS.notifications, ...saved.notifications },
        data: { ...DEFAULT_SETTINGS.data, ...saved.data },
        appearance: { ...DEFAULT_SETTINGS.appearance, ...saved.appearance },
      } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    setSaveStatus("saved");
    const timer = setTimeout(() => setSaveStatus("idle"), 1500);
    return () => clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.appearance.theme);
    if (settings.appearance.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme("system");
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [settings.appearance.theme]);

  const updateSetting = <K extends keyof SettingsState>(
    section: K,
    key: keyof SettingsState[K],
    value: SettingsState[K][keyof SettingsState[K]]
  ) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  };

  const resetSettings = () => {
    if (window.confirm("Reset all settings to default?")) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  const renderSettingsContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Toggle
                label="Auto-refresh quotes"
                enabled={settings.general.autoRefresh}
                onToggle={() => updateSetting("general", "autoRefresh", !settings.general.autoRefresh)}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Automatically update market prices every few seconds
              </p>

              <Toggle
                label="Show paper trading banner"
                enabled={settings.general.paperBanner}
                onToggle={() => updateSetting("general", "paperBanner", !settings.general.paperBanner)}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Remind that this is a simulated trading environment
              </p>
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Toggle
                label="Email notifications"
                enabled={settings.notifications.emailAlerts}
                onToggle={() => updateSetting("notifications", "emailAlerts", !settings.notifications.emailAlerts)}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Receive alerts via email (requires account setup)
              </p>

              <Toggle
                label="In-app notifications"
                enabled={settings.notifications.inAppAlerts}
                onToggle={() => updateSetting("notifications", "inAppAlerts", !settings.notifications.inAppAlerts)}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Show price alerts in the browser
              </p>
            </div>
          </div>
        );

      case "data":
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Toggle
                label="Yahoo Finance integration"
                enabled={settings.data.yahooData}
                onToggle={() => updateSetting("data", "yahooData", !settings.data.yahooData)}
              />
              <p className="text-xs text-muted-foreground -mt-3">
                Use Yahoo Finance for delayed quotes and charts
              </p>

              <div className="rounded-lg border border-border bg-panel p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Custom API</div>
                    <div className="text-sm text-muted-foreground">
                      Enterprise data feeds (Coming Soon)
                    </div>
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-md opacity-50 cursor-not-allowed"
                    disabled
                  >
                    Connect
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="space-y-6">
            <div>
              <div className="font-medium mb-3">Theme</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = settings.appearance.theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateSetting("appearance", "theme", opt.value)}
                      className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-sm">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case "keyboard":
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="font-medium text-muted-foreground">Shortcut</div>
              <div className="font-medium text-muted-foreground">Key</div>

              <div>Quick search</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">⌘K</div>

              <div>New order (Buy)</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">B</div>

              <div>New order (Sell)</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">S</div>

              <div>Open terminal</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">T</div>

              <div>Go to portfolio</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">P</div>

              <div>Cancel dialog</div>
              <div className="font-mono bg-panel px-2 py-1 rounded text-center">Esc</div>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-panel/50 p-4 text-sm text-muted-foreground">
              Keyboard shortcuts are active when focused on trading components.
            </div>
          </div>
        );

      case "privacy":
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-panel p-4">
                <h4 className="font-medium mb-2">Local Storage Only</h4>
                <p className="text-sm text-muted-foreground">
                  All your data — portfolio, orders, alerts, and settings — is stored locally in your browser.
                  We do not collect or transmit any personal information.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-panel p-4">
                <h4 className="font-medium mb-2">Clear Data</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Remove all locally stored data including portfolio, orders, alerts, and settings.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("This will clear all data. Are you sure?")) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                  className="px-4 py-2 bg-bear/10 text-bear rounded-md text-sm hover:bg-bear/20"
                >
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        );

      case "help":
        return (
          <div className="space-y-4">
            <a
              href="https://github.com/tanmay-alpha/MAET"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border bg-panel p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Documentation</div>
                  <div className="text-sm text-muted-foreground">Learn how to use MAET</div>
                </div>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </a>

            <a
              href="https://github.com/tanmay-alpha/MAET/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border bg-panel p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Report Issues</div>
                  <div className="text-sm text-muted-foreground">Found a bug? Let us know</div>
                </div>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </a>

            <a
              href="https://github.com/tanmay-alpha/MAET"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border bg-panel p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Source Code</div>
                  <div className="text-sm text-muted-foreground">View on GitHub</div>
                </div>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </a>

            <div className="rounded-lg border border-dashed border-border bg-panel/50 p-4">
              <div className="text-sm">
                <div className="font-medium mb-1">Version</div>
                <div className="text-muted-foreground">MAET v1.0.0</div>
              </div>
            </div>
          </div>
        );

      default:
        return <div className="py-8 text-center text-muted-foreground">Select a section</div>;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-xs text-muted-foreground">Application preferences</p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <Check className="h-4 w-4" />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={resetSettings}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-accent"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Layout */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Sidebar */}
        <div className="flex w-full shrink-0 overflow-x-auto border-b border-border md:block md:w-52 md:overflow-y-auto md:border-b-0 md:border-r">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`flex min-w-max items-center gap-3 px-4 py-3 text-left text-sm transition-colors md:w-full ${
                activeSection === section.id
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <section.icon className="h-4 w-4" />
              {section.title}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-1">{SETTINGS_SECTIONS.find(s => s.id === activeSection)?.title}</h2>
              <p className="text-sm text-muted-foreground">
                {SETTINGS_SECTIONS.find(s => s.id === activeSection)?.description}
              </p>
            </div>
            {renderSettingsContent()}
          </div>
        </div>
      </div>

      {/* Paper mode banner */}
      <div className="border-t border-border bg-panel/50">
        <PaperModeBanner />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — MAET" }] }),
  component: SettingsPage,
});

