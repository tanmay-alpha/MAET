/**
 * Simple equity curve chart component using canvas
 * No external chart library dependency
 */

import { useRef, useEffect } from "react";
import type { PerformanceDataPoint } from "@/hooks/use-portfolio-analytics";

interface EquityCurveChartProps {
  data: PerformanceDataPoint[];
  height?: number;
  showArea?: boolean;
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
    const padding = { top: 20, bottom: 30, left: 60, right: 20 };
    const chartWidth = width - padding.left - padding.right;
    const chartAreaHeight = chartHeight - padding.top - padding.bottom;

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
      ctx.fillText(`₹${(value / 1000).toFixed(0)}K`, 0, y + 3);
    }

    // Draw zero line if within range
    if (minVal < 0 && maxVal > 0) {
      const zeroY = padding.top + chartAreaHeight * (1 - (0 - minVal) / range);
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
    if (showArea) {
      ctx.beginPath();
      data.forEach((point, i) => {
        const x = padding.left + (chartWidth / (data.length - 1)) * i;
        const y = padding.top + chartAreaHeight * (1 - (point.value - minVal) / range);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
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
    ctx.strokeStyle = data[data.length - 1].value >= data[0].value ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    data.forEach((point, i) => {
      const x = padding.left + (chartWidth / (data.length - 1)) * i;
      const y = padding.top + chartAreaHeight * (1 - (point.value - minVal) / range);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw points
    if (data.length <= 20) {
      data.forEach((point, i) => {
        const x = padding.left + (chartWidth / (data.length - 1)) * i;
        const y = padding.top + chartAreaHeight * (1 - (point.value - minVal) / range);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = data[data.length - 1].value >= data[0].value ? "#22c55e" : "#ef4444";
        ctx.fill();
      });
    }

    // Current value label
    const lastPoint = data[data.length - 1];
    const lastX = padding.left + chartWidth;
    const lastY = padding.top + chartAreaHeight * (1 - (lastPoint.value - minVal) / range);
    ctx.fillStyle = data[data.length - 1].value >= data[0].value ? "#22c55e" : "#ef4444";
    ctx.font = "bold 11px monospace";
    ctx.fillText(`₹${(lastPoint.value / 1000).toFixed(1)}K`, lastX - 60, lastY - 8);
  }, [data, height, showArea]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
    />
  );
}
