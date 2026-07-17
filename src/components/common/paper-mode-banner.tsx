import { AlertTriangle } from "lucide-react";

export function PaperModeBanner() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-muted-foreground border-t border-border">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      <span>
        <strong>Paper trading mode</strong> — No real broker orders are executed. This is a research platform only.
      </span>
    </div>
  );
}