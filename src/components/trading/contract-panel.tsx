import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export function ContractPanel({ symbol, message }: { symbol: string; message?: string }) {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4">📋</div>
        <h3 className="text-xl font-semibold mb-2">Contract Not Available</h3>
        <p className="text-muted-foreground mb-4">
          {message || `No contract data available for ${symbol}`}
        </p>
        <p className="text-sm text-muted-foreground">
          This is a research platform. Real broker contracts are not available.
        </p>
        <Suspense fallback={<Loader2 className="h-4 w-4 animate-spin" />}>
          <div className="mt-6 text-sm text-muted-foreground">
            Data pipeline pending · Vendor integration required
          </div>
        </Suspense>
      </div>
    </div>
  );
}