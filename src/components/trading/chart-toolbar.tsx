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
  Settings,
  Download,
  Upload
} from "lucide-react";

export interface DrawingTool {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string;
}

export const DRAWING_TOOLS: DrawingTool[] = [
  {
    id: "trend",
    name: "Trendline",
    icon: TrendingUp,
    key: "t"
  },
  {
    id: "horizontal",
    name: "Horizontal Line",
    icon: Minus,
    key: "h"
  },
  {
    id: "vertical",
    name: "Vertical Line",
    icon: Plus,
    key: "v"
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    icon: Move,
    key: "f"
  },
  {
    id: "support",
    name: "Support/Resistance",
    icon: Move,
    key: "s"
  }
];

interface ChartToolbarProps {
  onToolSelect: (tool: string | null) => void;
  onToggleFullscreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  selectedTool: string | null;
  fullscreen: boolean;
  onSaveLayout?: () => void;
  onLoadLayout?: () => void;
}

export function ChartToolbar({
  onToolSelect,
  onToggleFullscreen,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  selectedTool,
  fullscreen,
  onSaveLayout,
  onLoadLayout
}: ChartToolbarProps) {
  const [showTools, setShowTools] = useState(false);

  return (
    <div className="absolute top-4 right-4 flex items-center gap-2 bg-panel/95 backdrop-blur rounded-lg border border-border shadow-lg z-20">
      {/* Tool selection dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          className={`p-2 rounded-md border border-border transition-colors ${
            showTools ? "bg-accent" : "hover:bg-accent/50"
          }`}
          title="Drawing Tools"
        >
          <Move className="h-4 w-4" />
        </button>

        {showTools && (
          <div className="absolute right-0 top-full mt-2 bg-panel rounded-lg border border-border shadow-xl min-w-[200px] p-2">
            <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">Drawing Tools</div>
            <div className="space-y-1">
              {DRAWING_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    onToolSelect(tool.id);
                    setShowTools(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors ${
                    selectedTool === tool.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <tool.icon className="h-4 w-4" />
                  <span className="text-sm">{tool.name}</span>
                  <span className="ml-auto text-xs bg-panel px-2 py-0.5 rounded">
                    {tool.key.toUpperCase()}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onToolSelect(null);
                  setShowTools(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors ${
                  selectedTool === null
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent/50"
                }`}
              >
                <Move className="h-4 w-4" />
                <span className="text-sm">Select</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div className="h-8 border-l border-border flex items-center">
        <button
          type="button"
          onClick={onZoomOut}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title="Zoom Out (-)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onResetZoom}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title="Reset Zoom (0)"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onZoomIn}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title="Zoom In (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {/* Layout save/load */}
      <div className="h-8 border-l border-border flex items-center gap-1">
        <button
          type="button"
          onClick={onSaveLayout}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title="Save Layout"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onLoadLayout}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title="Load Layout"
        >
          <Upload className="h-4 w-4" />
        </button>
      </div>

      {/* Settings and fullscreen */}
      <div className="h-8 border-l border-border flex items-center">
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="p-2 rounded-md hover:bg-accent/50 transition-colors"
          title={fullscreen ? "Exit Fullscreen (F11)" : "Fullscreen (F11)"}
        >
          {fullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}