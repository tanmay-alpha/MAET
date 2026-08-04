import type { LayoutType } from "@shared/research/contracts";
import { Square, Columns, Rows, Grid2X2, Link2, Link2Off } from "lucide-react";

interface LayoutSelectorProps {
  layoutType: LayoutType;
  onChangeLayout: (layout: LayoutType) => void;
  linkSymbol: boolean;
  onToggleLinkSymbol: () => void;
  linkCrosshair: boolean;
  onToggleLinkCrosshair: () => void;
}

export function LayoutSelector({
  layoutType,
  onChangeLayout,
  linkSymbol,
  onToggleLinkSymbol,
  linkCrosshair,
  onToggleLinkCrosshair,
}: LayoutSelectorProps) {
  return (
    <div className="flex items-center gap-1.5 border-l border-border pl-2 text-xs">
      <div className="flex items-center gap-0.5 bg-panel-elevated rounded p-0.5">
        <button
          type="button"
          onClick={() => onChangeLayout("SINGLE")}
          title="Single Chart (Alt+1)"
          className={`p-1 rounded transition ${layoutType === "SINGLE" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onChangeLayout("VERTICAL_2")}
          title="2 Charts Vertical (Alt+2)"
          className={`p-1 rounded transition ${layoutType === "VERTICAL_2" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Columns className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onChangeLayout("HORIZONTAL_2")}
          title="2 Charts Horizontal (Alt+Shift+2)"
          className={`p-1 rounded transition ${layoutType === "HORIZONTAL_2" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Rows className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onChangeLayout("GRID_4")}
          title="4 Grid Charts (Alt+4)"
          className={`p-1 rounded transition ${layoutType === "GRID_4" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Grid2X2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {layoutType !== "SINGLE" && (
        <div className="flex items-center gap-1 border-l border-border/60 pl-1.5">
          <button
            type="button"
            onClick={onToggleLinkSymbol}
            title={linkSymbol ? "Symbol Link Active" : "Symbol Link Disabled"}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition ${
              linkSymbol ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {linkSymbol ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
            <span>Symbol</span>
          </button>
          <button
            type="button"
            onClick={onToggleLinkCrosshair}
            title={linkCrosshair ? "Crosshair Link Active" : "Crosshair Link Disabled"}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition ${
              linkCrosshair ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {linkCrosshair ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
            <span>Crosshair</span>
          </button>
        </div>
      )}
    </div>
  );
}
