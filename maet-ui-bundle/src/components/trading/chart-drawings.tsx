"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import type { Candle } from "@/lib/mock-data";

export type DrawingType = "trendline" | "horizontal" | "fibonacci";
export type Drawing = {
  id: string;
  type: DrawingType;
  points: { x: number; y: number }[];
  color: string;
  timestamp: number;
};

export interface ChartDrawingsProps {
  drawings: Drawing[];
  onAddDrawing: (drawing: Drawing) => void;
  onUpdateDrawing: (id: string, points: { x: number; y: number }[]) => void;
  onRemoveDrawing: (id: string) => void;
  height: number;
  data: Candle[];
  chartWidth: number;
  priceRange: { min: number; max: number };
}

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function getCoordinateX(x: number, dataLength: number): number {
  return (x / (dataLength - 1)) * 100;
}

function getCoordinateY(price: number, minPrice: number, maxPrice: number): number {
  const range = maxPrice - minPrice;
  const pad = range * 0.05;
  const lo = minPrice - pad;
  const hi = maxPrice + pad;
  return ((hi - price) / (hi - lo)) * 100;
}

function getPriceFromY(yPercent: number, minPrice: number, maxPrice: number): number {
  const range = maxPrice - minPrice;
  const pad = range * 0.05;
  const lo = minPrice - pad;
  const hi = maxPrice + pad;
  return hi - (yPercent / 100) * (hi - lo);
}

function getIdxFromX(xPercent: number, dataLength: number): number {
  return Math.round((xPercent / 100) * (dataLength - 1));
}

export function ChartDrawings({
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onRemoveDrawing,
  height,
  data,
  chartWidth,
  priceRange,
}: ChartDrawingsProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingType>("trendline");
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);

  const padding = (priceRange.max - priceRange.min) * 0.05;
  const lo = priceRange.min - padding;
  const hi = priceRange.max + padding;
  const priceRange_ = useMemo(() => ({ min: lo, max: hi }), [lo, hi]);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Start new drawing
    const price = getPriceFromY(y, priceRange_.min, priceRange_.max);
    const idx = getIdxFromX(x, data.length);

    const newDrawing: Drawing = {
      id: `drawing-${Date.now()}`,
      type: activeTool,
      points: [{ x, y: getCoordinateY(price, priceRange_.min, priceRange_.max) }],
      color: selectedColor,
      timestamp: Date.now(),
    };

    setCurrentDrawing(newDrawing);
    onAddDrawing(newDrawing);
    setIsDrawing(true);
    e.preventDefault();
  }, [activeTool, selectedColor, data.length, priceRange_, onAddDrawing]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || !currentDrawing) return;

    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (currentDrawing.type === "fibonacci") {
      // For Fibonacci, calculate levels based on start and end points
      const startY = currentDrawing.points[0].y;
      const endY = y;
      const diff = endY - startY;
      const newPoints = FIB_LEVELS.map(level => ({
        x,
        y: startY + diff * (1 - level)
      }));
      setCurrentDrawing({ ...currentDrawing, points: newPoints });
    } else if (currentDrawing.type === "horizontal") {
      // Horizontal line spans full width
      setCurrentDrawing({
        ...currentDrawing,
        points: [{ x: 0, y }, { x: 100, y }],
      });
    } else {
      // Trendline
      setCurrentDrawing({
        ...currentDrawing,
        points: [currentDrawing.points[0], { x, y }],
      });
    }
  }, [isDrawing, currentDrawing]);

  const handleSvgMouseUp = useCallback(() => {
    if (isDrawing && currentDrawing) {
      // Only add if we have valid points
      if (currentDrawing.points.length >= 1) {
        onUpdateDrawing(currentDrawing.id, currentDrawing.points);
      }
      setCurrentDrawing(null);
      setIsDrawing(false);
    }
  }, [isDrawing, currentDrawing, onUpdateDrawing]);

  const renderDrawing = useCallback((drawing: Drawing) => {
    if (drawing.points.length < 2 && drawing.type !== "fibonacci") return null;

    const commonProps = {
      stroke: drawing.color,
      strokeWidth: 1,
      opacity: 0.85,
    };

    if (drawing.type === "horizontal" && drawing.points.length >= 1) {
      const y = drawing.points[0].y;
      return (
        <g key={drawing.id}>
          <line x1="0" x2="100" y1={y} y2={y} {...commonProps} strokeDasharray="6,4" />
          <text x="101" y={y + 2} fill={drawing.color} fontSize="3" fontFamily="var(--font-mono)">
            {getPriceFromY(y, priceRange_.min, priceRange_.max).toFixed(2)}
          </text>
        </g>
      );
    }

    if (drawing.type === "fibonacci" && drawing.points.length === FIB_LEVELS.length) {
      const startY = drawing.points[0].y;
      const endY = drawing.points[FIB_LEVELS.length - 1].y;
      const diff = endY - startY;

      return (
        <g key={drawing.id}>
          {FIB_LEVELS.map((level, i) => {
            const y = startY + diff * (1 - level);
            const price = getPriceFromY(y, priceRange_.min, priceRange_.max);
            const label = level === 0 || level === 1
              ? `${(level * 100).toFixed(0)}%`
              : `${(level * 100).toFixed(1)}%`;

            return (
              <g key={i}>
                <line x1="0" x2="100" y1={y} y2={y} {...commonProps} strokeDasharray={i === 0 || i === FIB_LEVELS.length - 1 ? undefined : "3,3"} />
                <text x="101" y={y + 2} fill={drawing.color} fontSize="2.5" fontFamily="var(--font-mono)">
                  {label} ({price.toFixed(2)})
                </text>
              </g>
            );
          })}
        </g>
      );
    }

    if (drawing.type === "trendline" && drawing.points.length >= 2) {
      const [start, end] = drawing.points;
      return (
        <g key={drawing.id}>
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...commonProps} />
        </g>
      );
    }

    return null;
  }, [priceRange_]);

  const renderCurrentDrawing = useCallback(() => {
    if (!currentDrawing) return null;

    const commonProps = {
      stroke: currentDrawing.color,
      strokeWidth: 1.5,
      opacity: 0.9,
    };

    if (currentDrawing.type === "horizontal" && currentDrawing.points.length >= 1) {
      const y = currentDrawing.points[0].y;
      return <line x1="0" x2="100" y1={y} y2={y} {...commonProps} strokeDasharray="6,4" />;
    }

    if (currentDrawing.type === "fibonacci" && currentDrawing.points.length === FIB_LEVELS.length) {
      const startY = currentDrawing.points[0].y;
      const endY = currentDrawing.points[FIB_LEVELS.length - 1].y;
      const diff = endY - startY;

      return (
        <g>
          {FIB_LEVELS.map((level, i) => {
            const y = startY + diff * (1 - level);
            return <line key={i} x1="0" x2="100" y1={y} y2={y} {...commonProps} strokeDasharray={i === 0 || i === FIB_LEVELS.length - 1 ? undefined : "3,3"} />;
          })}
        </g>
      );
    }

    if (currentDrawing.type === "trendline" && currentDrawing.points.length >= 1) {
      const start = currentDrawing.points[0];
      if (currentDrawing.points.length === 1) {
        return <circle cx={start.x} cy={start.y} r="2" fill={currentDrawing.color} />;
      }
      const end = currentDrawing.points[1];
      return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...commonProps} />;
    }

    return null;
  }, [currentDrawing]);

  return {
    svgRef,
    activeTool,
    setActiveTool,
    selectedColor,
    setSelectedColor,
    colors: COLORS,
    renderDrawingsOverlay: (
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 pointer-events-auto cursor-crosshair"
        style={{ width: `calc(100% - 56px)`, height }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        {drawings.map(renderDrawing)}
        {renderCurrentDrawing()}
      </svg>
    ),
  };
}

export function DrawingToolbar({
  activeTool,
  onToolChange,
  selectedColor,
  onColorChange,
  colors,
  drawings,
  onClearAll,
}: {
  activeTool: DrawingType;
  onToolChange: (tool: DrawingType) => void;
  selectedColor: string;
  onColorChange: (color: string) => void;
  colors: string[];
  drawings: Drawing[];
  onClearAll: () => void;
}) {
  const tools: { id: DrawingType; label: string; icon: string }[] = [
    { id: "trendline", label: "T", icon: "/" },
    { id: "horizontal", label: "H", icon: "─" },
    { id: "fibonacci", label: "F", icon: "≋" },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-border bg-panel px-2 py-1 text-xs">
      <span className="mr-1 text-muted-foreground">Draw:</span>
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          title={tool.label}
          className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${
            activeTool === tool.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          }`}
        >
          {tool.icon}
        </button>
      ))}

      <div className="mx-2 h-4 w-px bg-border" />

      {colors.map((color) => (
        <button
          key={color}
          onClick={() => onColorChange(color)}
          className={`h-4 w-4 rounded-sm border border-border/50 ${
            selectedColor === color ? "ring-1 ring-primary ring-offset-1 ring-offset-background" : ""
          }`}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-muted-foreground">{drawings.length} drawings</span>
        {drawings.length > 0 && (
          <button
            onClick={onClearAll}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
