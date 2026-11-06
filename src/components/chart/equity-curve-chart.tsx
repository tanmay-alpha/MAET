/**
 * Simple equity curve chart component using canvas
 * No external chart library dependency
 *
 * Points are spaced by calendar date, so days without a snapshot show as gaps.
 * Stale-price points are amber; provisional (intraday, never closed) points
 * are hollow; the generation-start anchor is a hollow square.
 */

import { useRef, useEffect } from "react";
import { dateSpacedX, type PerformanceDataPoint } from "@/lib/portfolio-curve";

interface EquityCurveChartProps {
  data: PerformanceDataPoint[];
  height?: number;
  showArea?: boolean;
}

const STALE_COLOR = "#f59e0b";

function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function EquityCurveChart({ data, height = 200, showArea = true }: EquityCurveChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const chartHeight = height;

    // Clear
    ctx.clearRect(0, 0, width, chartHeight);

    // Find min/max
    const values = data.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const padding = { top: 20, bottom: 30, left: 80, right: 20 };
    const chartWidth = width - padding.left - padding.right;
    const chartAreaHeight = chartHeight - padding.top - padding.bottom;
    const xs = dateSpacedX(data.map((point) => point.date), padding.left, chartWidth);
    const xAt = (i: number) => xs[i]!;
    const yAt = (value: number) => padding.top + chartAreaHeight * (1 - (value - minVal) / range);
    const trendColor = data[data.length - 1].value >= data[0].value ? "#22c55e" : "#ef4444";

    // Draw grid lines
    ctx.strokeStyle = "#e5e5e5";
    ctx.lineWidth = 0.5;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#888";

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartAreaHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      const value = maxVal - (range / gridLines) * i;
      ctx.fillText(formatRupees(value), 0, y + 3);
    }

    // Date labels for the first and last snapshot
    ctx.fillText(data[0].date, padding.left, chartHeight - 8);
    if (data.length > 1) {
      const lastLabel = data[data.length - 1].date;
      ctx.fillText(lastLabel, width - padding.right - ctx.measureText(lastLabel).width, chartHeight - 8);
    }

    // Draw zero line if within range
    if (minVal < 0 && maxVal > 0) {
      const zeroY = yAt(0);
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw area
    if (showArea && data.length > 1) {
      ctx.beginPath();
      data.forEach((point, i) => {
        if (i === 0) ctx.moveTo(xAt(i), yAt(point.value));
        else ctx.lineTo(xAt(i), yAt(point.value));
      });
      ctx.lineTo(padding.left + chartWidth, padding.top + chartAreaHeight);
      ctx.lineTo(padding.left, padding.top + chartAreaHeight);
      ctx.closePath();

      const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartAreaHeight);
      const isProfit = data[data.length - 1].value >= data[0].value;
      if (isProfit) {
        gradient.addColorStop(0, "rgba(34, 197, 94, 0.2)");
        gradient.addColorStop(1, "rgba(34, 197, 94, 0.02)");
      } else {
        gradient.addColorStop(0, "rgba(239, 68, 68, 0.2)");
        gradient.addColorStop(1, "rgba(239, 68, 68, 0.02)");
      }
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = trendColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    data.forEach((point, i) => {
      if (i === 0) ctx.moveTo(xAt(i), yAt(point.value));
      else ctx.lineTo(xAt(i), yAt(point.value));
    });
    ctx.stroke();

    // Draw points: stale prices amber, provisional hollow, the start anchor a hollow square.
    ctx.lineWidth = 1.5;
    data.forEach((point, i) => {
      if (data.length > 20 && !point.stale && !point.provisional && !point.anchor) return;
      const color = point.stale ? STALE_COLOR : trendColor;
      const x = xAt(i);
      const y = yAt(point.value);
      ctx.beginPath();
      if (point.anchor) {
        ctx.rect(x - 3, y - 3, 6, 6);
      } else {
        ctx.arc(x, y, 3, 0, Math.PI * 2);
      }
      if (point.anchor || point.provisional) {
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    });

    // Current value label
    const lastPoint = data[data.length - 1];
    ctx.fillStyle = trendColor;
    ctx.font = "bold 11px monospace";
    const lastLabel = formatRupees(lastPoint.value);
    const labelX = Math.max(padding.left, xAt(data.length - 1) - ctx.measureText(lastLabel).width);
    ctx.fillText(lastLabel, labelX, yAt(lastPoint.value) - 8);
  }, [data, height, showArea]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
    />
  );
}
