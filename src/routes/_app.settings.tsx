import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Settings, Bell, Database, Palette, Keyboard, BookOpen } from "lucide-react";
import { PaperModeBanner } from "@/components/common/paper-mode-banner";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — MAET" }] }),
  component: SettingsPage,
});

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
    id: "help",
    title: "Help & Support",
    description: "Documentation and assistance",
    icon: BookOpen,
  },
];

function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");

  const renderSettingsContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Auto-refresh quotes</div>
                <div className="text-sm text-muted-foreground">Update prices automatically</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Show paper-only banner</div>
                <div className="text-sm text-muted-foreground">Remind that this is not a broker</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Email notifications</div>
                <div className="text-sm text-muted-foreground">Receive alerts via email</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">In-app notifications</div>
                <div className="text-sm text-muted-foreground">Show price alerts in the app</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        );

      case "data":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Yahoo Finance</div>
                <div className="text-sm text-muted-foreground">Market quotes and charts</div>
              </div>
              <span className="text-sm text-green-600">Connected</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Custom API</div>
                <div className="text-sm text-muted-foreground">Enterprise data feeds</div>
              </div>
              <button className="text-sm text-primary hover:underline">Connect</button>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="space-y-4">
            <div>
              <div className="font-medium mb-2">Theme</div>
              <div className="flex gap-2">
                <button className="rounded-md border border-border bg-panel px-3 py-2 text-sm">Light</button>
                <button className="rounded-md bg-accent px-3 py-2 text-sm">Dark</button>
                <button className="rounded-md border border-border bg-panel px-3 py-2 text-sm">System</button>
              </div>
            </div>
          </div>
        );

      case "keyboard":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="font-medium">Shortcuts</div>
              <div></div>
              <div className="text-muted-foreground">Quick search</div>
              <div className="font-mono">⌘K</div>
              <div className="text-muted-foreground">New symbol</div>
              <div className="font-mono">N</div>
              <div className="text-muted-foreground">Open terminal</div>
              <div className="font-mono">T</div>
              <div className="text-muted-foreground">Sell order</div>
              <div className="font-mono">S</div>
              <div className="text-muted-foreground">Buy order</div>
              <div className="font-mono">B</div>
            </div>
          </div>
        );

      case "help":
        return (
          <div className="space-y-4">
            <button className="w-full rounded-md border border-border bg-panel p-3 text-left hover:bg-accent/50">
              <div className="font-medium">User Guide</div>
              <div className="text-sm text-muted-foreground">Learn how to use MAET</div>
            </button>
            <button className="w-full rounded-md border border-border bg-panel p-3 text-left hover:bg-accent/50">
              <div className="font-medium">API Documentation</div>
              <div className="text-sm text-muted-foreground">Market data API reference</div>
            </button>
            <button className="w-full rounded-md border border-border bg-panel p-3 text-left hover:bg-accent/50">
              <div className="font-medium">Contact Support</div>
              <div className="text-sm text-muted-foreground">Get help from the team</div>
            </button>
          </div>
        );

      default:
        return <div className="py-8 text-center text-muted-foreground">Select a section</div>;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-5 py-3">
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      {/* Layout */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-48 border-r border-border overflow-y-auto">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full text-left px-4 py-3 text-sm flex items-center gap-3 ${
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
        <div className="flex-1 overflow-auto p-4">
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
