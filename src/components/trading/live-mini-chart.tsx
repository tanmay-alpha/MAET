import { useId } from "react";

export function LiveMiniChart({ data, height = 280 }: { data: number[]; height?: number }) {
  const gradientId = useId().replace(/:/g, "");

  if (data.length < 2) {
    return (
      <div
        className="flex w-full items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        Waiting for market history…
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;
  const W = 100, H = 100;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * W},${((hi - v) / (hi - lo)) * H}`).join(" ");
  const areaPath = `M0,${H} L${points.split(" ").join(" L")} L${W},${H} Z`;
  const last = data[data.length - 1];
  const first = data[0];
  const bull = last >= first;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: "100%" }} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={bull ? "var(--color-bull)" : "var(--color-bear)"} stopOpacity="0.35" />
          <stop offset="100%" stopColor={bull ? "var(--color-bull)" : "var(--color-bear)"} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 5 }).map((_, i) => (
        <line key={i} x1="0" x2="100" y1={(i / 4) * 100} y2={(i / 4) * 100} stroke="var(--color-grid)" strokeWidth="0.1" />
      ))}
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={bull ? "var(--color-bull)" : "var(--color-bear)"} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <circle
        cx={W}
        cy={((hi - last) / (hi - lo)) * H}
        r="0.9"
        fill={bull ? "var(--color-bull)" : "var(--color-bear)"}
      >
        <animate attributeName="r" values="0.9;2.2;0.9" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
