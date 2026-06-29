/**
 * Drawing tools for chart workspace
 * Supports: trendlines, support/resistance, fibonacci retracements
 */

export interface Point {
  x: number;
  y: number;
}

export interface Drawing {
  id: string;
  type: 'trendline' | 'support' | 'resistance' | 'fibonacci';
  points: Point[];
  color: string;
  label?: string;
  timestamp: number;
}

export interface DrawingTool {
  type: Drawing['type'];
  name: string;
  icon: string;
  cursor: string;
  minPoints: number;
  maxPoints: number;
}

export const DRAWING_TOOLS: DrawingTool[] = [
  { type: 'trendline', name: 'Trendline', icon: '📈', cursor: 'crosshair', minPoints: 2, maxPoints: 2 },
  { type: 'support', name: 'Support', icon: '⬆️', cursor: 'crosshair', minPoints: 2, maxPoints: 2 },
  { type: 'resistance', name: 'Resistance', icon: '⬇️', cursor: 'crosshair', minPoints: 2, maxPoints: 2 },
  { type: 'fibonacci', name: 'Fibonacci', icon: '📊', cursor: 'crosshair', minPoints: 2, maxPoints: 2 },
];

export const FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export interface DrawingState {
  activeTool: Drawing['type'] | null;
  drawings: Drawing[];
  currentPoints: Point[];
}

export function createDrawing(type: Drawing['type'], points: Point[]): Drawing {
  return {
    id: crypto.randomUUID(),
    type,
    points,
    color: getDefaultColor(type),
    timestamp: Date.now(),
  };
}

function getDefaultColor(type: Drawing['type']): string {
  const colors = {
    trendline: '#3b82f6',
    support: '#22c55e',
    resistance: '#ef4444',
    fibonacci: '#a855f7',
  };
  return colors[type];
}

export function calculateFibonacciLevels(startY: number, endY: number): Array<{ level: number; y: number }> {
  const range = Math.abs(endY - startY);
  const min = Math.min(startY, endY);

  return FIBONACCI_LEVELS.map(level => ({
    level,
    y: min + (range * level),
  }));
}

export function isPointNearLine(point: Point, lineStart: Point, lineEnd: Point, threshold = 10): boolean {
  const { x, y } = point;
  const { x: x1, y: y1 } = lineStart;
  const { x: x2, y: y2 } = lineEnd;

  // Calculate distance from point to line
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy) < threshold;
}