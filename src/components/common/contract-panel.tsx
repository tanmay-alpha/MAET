import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export function ContractPanel({ symbol, message }: { symbol?: string; message?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs">
      <Suspense fallback={<Loader2 className="h-3 w-3 animate-spin" />}>
        <span>📋</span>
      </Suspense>
      <span>
        {message || `Contract data not available for ${symbol}`}
      </span>
    </div>
  );
}

export const CONTRACT_PANEL = ContractPanel;