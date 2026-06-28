import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, Plus, Trash2, Check, X } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Alerts — MAET" }] }),
  component: Alerts,
});

const MOCK_ALERTS = [
  {
    id: "1",
    symbol: "RELIANCE",
    condition: "Price above",
    value: 2500,
    triggered: false,
    created: "2026-06-27",
  },
  {
    id: "2",
    symbol: "TCS",
    condition: "Price below",
    value: 3400,
    triggered: true,
    created: "2026-06-26",
  },
];

function Alerts() {
  const [alerts] = useState(MOCK_ALERTS);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Price Alerts</h1>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Create alert
        </button>
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-auto">
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="No alerts"
              description="Create price alerts to get notified when symbols hit your target levels."
              action={{ label: "Create first alert", onClick: () => {} }}
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-accent/50"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full ${alert.triggered ? "bg-primary" : "bg-bull animate-pulse"}`} />
                  <div>
                    <div className="font-semibold">{alert.symbol}</div>
                    <div className="text-sm text-muted-foreground">
                      {alert.condition} ₹{alert.value.toLocaleString("en-IN")}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{alert.created}</div>
                    <div className={alert.triggered ? "text-primary" : "text-muted-foreground"}>
                      {alert.triggered ? "Triggered" : "Active"}
                    </div>
                  </div>

                  <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <ContractPanel message="Alerts are stored locally in your browser — they will trigger when the condition is met" />
      </div>
    </div>
  );
}
