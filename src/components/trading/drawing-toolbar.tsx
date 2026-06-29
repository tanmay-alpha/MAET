/**
 * DrawingTools Component
 * Toolbar for selecting and managing drawing tools on charts
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DRAWING_TOOLS, type Drawing } from "@/lib/drawing-tools";
import { cn } from "@/lib/utils";

interface DrawingToolbarProps {
  activeTool: Drawing["type"] | null;
  onToolSelect: (tool: Drawing["type"] | null) => void;
  onClear: () => void;
  drawingCount: number;
}

export function DrawingToolbar({
  activeTool,
  onToolSelect,
  onClear,
  drawingCount,
}: DrawingToolbarProps) {
  const currentToolInfo = DRAWING_TOOLS.find((t) => t.type === activeTool);

  const handleToolSelect = useCallback(
    (type: Drawing["type"]) => {
      if (activeTool === type) {
        onToolSelect(null); // Deselect if clicking same tool
      } else {
        onToolSelect(type);
      }
    },
    [activeTool, onToolSelect]
  );

  return (
    <div className="flex items-center gap-1 p-1 bg-card rounded-lg border shadow-sm">
      {/* Tool Selection */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-2",
              activeTool && "bg-accent text-accent-foreground"
            )}
          >
            <span>{currentToolInfo?.icon ?? "✏️"}</span>
            <span className="hidden sm:inline">
              {currentToolInfo?.name ?? "Draw"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {DRAWING_TOOLS.map((tool) => (
            <DropdownMenuItem
              key={tool.type}
              onClick={() => handleToolSelect(tool.type)}
              className={cn(
                "gap-2",
                activeTool === tool.type && "bg-accent"
              )}
            >
              <span>{tool.icon}</span>
              <span>{tool.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Divider */}
      <div className="w-px h-6 bg-border mx-1" />

      {/* Quick Tools */}
      {DRAWING_TOOLS.slice(0, 4).map((tool) => (
        <Tooltip key={tool.type}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleToolSelect(tool.type)}
              className={cn(
                "h-8 w-8",
                activeTool === tool.type &&
                  "bg-accent text-accent-foreground"
              )}
            >
              <span>{tool.icon}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tool.name}</p>
          </TooltipContent>
        </Tooltip>
      ))}

      {/* Divider */}
      <div className="w-px h-6 bg-border mx-1" />

      {/* Clear All */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={drawingCount === 0}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <TrashIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Clear all drawings ({drawingCount})</p>
        </TooltipContent>
      </Tooltip>

      {/* Drawing Count Badge */}
      {drawingCount > 0 && (
        <div className="ml-2 px-2 py-0.5 bg-secondary rounded-full text-xs text-secondary-foreground">
          {drawingCount}
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

export default DrawingToolbar;