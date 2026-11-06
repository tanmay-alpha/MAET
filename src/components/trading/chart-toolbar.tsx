import { useState } from "react";
import {
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  TrendingUp,
  Minus,
  Plus,
} from "lucide-react";

export interface DrawingTool {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string;
}

export const DRAWING_TOOLS: DrawingTool[] = [
  { id: "trend", name: "Trendline", icon: TrendingUp, key: "t" },
  { id: "horizontal", name: "Horizontal line", icon: Minus, key: "h" },
  { id: "vertical", name: "Vertical line", icon: Plus, key: "v" },
  { id: "fibonacci", name: "Fibonacci", icon: Move, key: "f" },
  { id: "support", name: "Support/resistance", icon: Move, key: "s" },
];

interface ChartToolbarProps {
  onToolSelect: (tool: string | null) => void;
  onToggleFullscreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  selectedTool: string | null;
  fullscreen: boolean;
}

const ICON_BUTTON = "rounded p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground";

export function ChartToolbar({
  onToolSelect,
  onToggleFullscreen,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  selectedTool,
  fullscreen,
}: ChartToolbarProps) {
  const [showTools, setShowTools] = useState(false);
  const activeTool = DRAWING_TOOLS.find((tool) => tool.id === selectedTool);

  return (
    <div className="flex items-center gap-0.5">
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          aria-expanded={showTools}
          className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${
            showTools || activeTool ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          }`}
          title="Drawing tools"
        >
          <Move className="h-3.5 w-3.5" />
          <span>{activeTool?.name ?? "Draw"}</span>
        </button>

        {showTools && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[200px] border border-border bg-panel p-1">
            {DRAWING_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  onToolSelect(tool.id);
                  setShowTools(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                  selectedTool === tool.id ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
                }`}
              >
                <tool.icon className="h-4 w-4" />
                <span>{tool.name}</span>
                <kbd className="ml-auto font-mono text-xs opacity-70">{tool.key.toUpperCase()}</kbd>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                onToolSelect(null);
                setShowTools(false);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                selectedTool === null ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
              }`}
            >
              <span className="w-4" />
              <span>No tool</span>
              <kbd className="ml-auto font-mono text-xs opacity-70">Esc</kbd>
            </button>
          </div>
        )}
      </div>

      <span className="mx-1 h-4 border-l border-border" />
      <button type="button" onClick={onZoomOut} className={ICON_BUTTON} title="Zoom out (−)" aria-label="Zoom out">
        <ZoomOut className="h-4 w-4" />
      </button>
      <button type="button" onClick={onResetZoom} className={ICON_BUTTON} title="Reset zoom (0)" aria-label="Reset zoom">
        <RotateCcw className="h-4 w-4" />
      </button>
      <button type="button" onClick={onZoomIn} className={ICON_BUTTON} title="Zoom in (+)" aria-label="Zoom in">
        <ZoomIn className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 border-l border-border" />
      <button
        type="button"
        onClick={onToggleFullscreen}
        className={ICON_BUTTON}
        title={fullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)"}
        aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
